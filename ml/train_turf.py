"""
Serviceable-area segmentation — trained on hand-drawn labels.

Trains a U-Net with a PRETRAINED ResNet18 encoder to predict per-class masks
from a satellite tile. The output has one channel per class in CLASSES
(independent sigmoids, NOT a softmax) so a pixel can be turf OR tree and the
classes are learned with their own pos_weight — important because each is a
different-sized pixel minority.

Rigor (v2):
  - Deterministic TRAIN/VAL split by property-name hash (~20% val), so reported
    val-IoU measures generalization, not memorization, and is comparable
    across runs as labels accumulate.
  - Per-sample augmentation (flips + 90° rotations) and mini-batch training
    (many optimizer steps per epoch instead of one full-batch step).
  - Best-checkpoint saving: the model written to disk is the one with the best
    mean val IoU, not whatever the last epoch produced.

Usage:
  npm run export:training          # produce training-data/
  python3 ml/train_turf.py         # train + report train/val IoU per class

Env overrides (iterate fast while labeling; long run for a final model):
  FAST=1 python3 ml/train_turf.py           # SIZE 384, EPOCHS 30 (~3-4x faster)
  SIZE=512 EPOCHS=60 BATCH=4 ...            # explicit
"""
import copy
import hashlib
import json
import os
import random
import numpy as np
from PIL import Image
import torch
import torch.nn as nn
import torch.nn.functional as F
import torchvision

ROOT = os.path.join(os.path.dirname(__file__), "..", "training-data")
# An "epoch" is a full pass over the train split in mini-batches (several
# optimizer steps), so far fewer epochs are needed than the old full-batch
# trainer (which took ONE step per epoch).
FAST = os.environ.get("FAST", "") not in ("", "0", "false")
SIZE = int(os.environ.get("SIZE", "384" if FAST else "512"))
EPOCHS = int(os.environ.get("EPOCHS", "30" if FAST else "60"))
BATCH = int(os.environ.get("BATCH", "4"))
EVAL_EVERY = 5
SEED = 0

# Classes the model predicts, in output-channel order. Each output channel
# learns from one or more label ids (lib/geo/raster CLASS_INDEX) via
# CLASS_SOURCES — labels stay fine-grained in the DB; merging happens here,
# at train time, where it's reversible:
#   - sports_turf pixels TRAIN the turf channel: a sports field IS mowable
#     grass, and the old setup taught the model the opposite (sports pixels
#     were background for the turf channel). Whether turf is "sports" is a
#     property-context question (see lib/integrations/turf-model screening),
#     not a pixel question — its standalone channel scored 0.016 val IoU.
#   - building + pavement merge into one "hardscape" channel: both are
#     impervious non-mowable surface, the product treats them identically
#     (SUBTRACT_FROM_TURF), and telling a flat roof from a parking lot in
#     RGB is exactly what the old model couldn't do (pavement 0.14 IoU).
CLASSES = ["turf", "tree", "hardscape"]
CLASS_IDS = {"turf": 1, "bed": 2, "tree": 3, "building": 4, "pavement": 5, "other": 6, "sports_turf": 7}
CLASS_SOURCES = {
    "turf": [CLASS_IDS["turf"], CLASS_IDS["sports_turf"]],
    "tree": [CLASS_IDS["tree"]],
    "hardscape": [CLASS_IDS["building"], CLASS_IDS["pavement"]],
}
# Back-compat alias (older predict scripts imported TURF_CLASS).
TURF_CLASS = CLASS_IDS["turf"]

random.seed(SEED); np.random.seed(SEED); torch.manual_seed(SEED)


def is_val(name: str) -> bool:
    """Deterministic ~20% validation split, stable across runs/label growth."""
    return int(hashlib.md5(name.encode()).hexdigest(), 16) % 5 == 0


def load_samples():
    items = []
    with open(os.path.join(ROOT, "metadata.jsonl")) as f:
        for line in f:
            r = json.loads(line)
            img = Image.open(os.path.join(ROOT, r["file_name"])).convert("RGB").resize((SIZE, SIZE), Image.BILINEAR)
            m = Image.open(os.path.join(ROOT, r["mask"])).convert("RGB").resize((SIZE, SIZE), Image.NEAREST)
            x = torch.from_numpy(np.asarray(img, dtype=np.float32) / 255.0).permute(2, 0, 1)
            mask_cls = np.asarray(m)[:, :, 0]  # class id stored in R channel
            # One binary plane per class -> (C, H, W); a plane is the union
            # of its source label ids (CLASS_SOURCES).
            planes = [
                np.isin(mask_cls, CLASS_SOURCES[c]).astype(np.float32) for c in CLASSES
            ]
            y = torch.from_numpy(np.stack(planes, axis=0))
            items.append((r["property"], x, y))
    return items


class UNet(nn.Module):
    """U-Net with a ResNet18 encoder. Input: RGB in [0,1] — ImageNet
    normalization happens inside forward, so callers stay unchanged.
    `pretrained` matters only for training; when loading a checkpoint the
    downloaded weights would be overwritten anyway, so it defaults False."""

    def __init__(s, n_classes=len(CLASSES), pretrained=False):
        super().__init__()
        weights = None
        if pretrained:
            try:
                weights = torchvision.models.ResNet18_Weights.IMAGENET1K_V1
            except AttributeError:
                weights = None
        try:
            r = torchvision.models.resnet18(weights=weights)
        except Exception as e:  # offline / download failure -> train from scratch
            print(f"  (pretrained weights unavailable: {e}; encoder from scratch)")
            r = torchvision.models.resnet18(weights=None)
        s.register_buffer("in_mean", torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1))
        s.register_buffer("in_std", torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1))
        s.stem = nn.Sequential(r.conv1, r.bn1, r.relu)                    # /2, 64
        s.pool = r.maxpool                                                # /4
        s.e1, s.e2, s.e3, s.e4 = r.layer1, r.layer2, r.layer3, r.layer4  # 64,128,256,512

        def blk(i, o):
            return nn.Sequential(
                nn.Conv2d(i, o, 3, padding=1), nn.ReLU(inplace=True),
                nn.Conv2d(o, o, 3, padding=1), nn.ReLU(inplace=True),
            )

        s.d4, s.d3, s.d2, s.d1 = blk(512 + 256, 256), blk(256 + 128, 128), blk(128 + 64, 64), blk(64 + 64, 64)
        s.out = nn.Conv2d(64, n_classes, 1)

    def encoder_parameters(s):
        for m in (s.stem, s.e1, s.e2, s.e3, s.e4):
            yield from m.parameters()

    def decoder_parameters(s):
        for m in (s.d4, s.d3, s.d2, s.d1, s.out):
            yield from m.parameters()

    def forward(s, x):
        x = (x - s.in_mean) / s.in_std
        c0 = s.stem(x)
        c1 = s.e1(s.pool(c0))
        c2 = s.e2(c1)
        c3 = s.e3(c2)
        c4 = s.e4(c3)

        def up(t, ref):
            return F.interpolate(t, size=ref.shape[-2:], mode="bilinear", align_corners=False)

        d4 = s.d4(torch.cat([up(c4, c3), c3], 1))
        d3 = s.d3(torch.cat([up(d4, c2), c2], 1))
        d2 = s.d2(torch.cat([up(d3, c1), c1], 1))
        d1 = s.d1(torch.cat([up(d2, c0), c0], 1))
        return F.interpolate(s.out(d1), size=x.shape[-2:], mode="bilinear", align_corners=False)


def iou(logits, y):
    """Per-sample IoU for a single class channel. Returns None when the label has
    no positive pixels (so an absent class isn't scored as a perfect 1.0)."""
    p = (torch.sigmoid(logits) > 0.5).float()
    inter = (p * y).sum().item()
    union = ((p + y) > 0).float().sum().item()
    if y.sum().item() == 0:
        return None
    return inter / union if union else 1.0


def dice_loss(logits, y):
    p = torch.sigmoid(logits)
    num = 2 * (p * y).sum() + 1
    den = p.sum() + y.sum() + 1
    return 1 - num / den


def augment(x, y):
    """Per-sample flips + 90° rotations (tiles are square)."""
    if random.random() < 0.5:
        x, y = x.flip(-1), y.flip(-1)
    if random.random() < 0.5:
        x, y = x.flip(-2), y.flip(-2)
    k = random.randint(0, 3)
    if k:
        x, y = torch.rot90(x, k, (-2, -1)), torch.rot90(y, k, (-2, -1))
    return x, y


@torch.no_grad()
def evaluate(model, X, Y, names):
    """Per-class mean IoU over a split (batched to bound memory). Returns
    ({class: mean-or-None}, per_property_rows)."""
    model.eval()
    per_class = {c: [] for c in CLASSES}
    rows = []
    for i0 in range(0, len(X), BATCH):
        logits = model(X[i0:i0 + BATCH])
        for j in range(logits.shape[0]):
            i = i0 + j
            parts = []
            for ci, c in enumerate(CLASSES):
                v = iou(logits[j, ci:ci + 1], Y[i, ci:ci + 1])
                if v is not None:
                    per_class[c].append(v)
                parts.append(f"{c} {v:.3f}" if v is not None else f"{c}  n/a")
            rows.append(f"  {names[i]:34s} " + "  ".join(parts))
    means = {c: (float(np.mean(v)) if v else None) for c, v in per_class.items()}
    return means, rows


def fmt_means(means):
    return "  ".join(f"{c}-IoU {m:.3f}" if m is not None else f"{c}-IoU  n/a" for c, m in means.items())


def main():
    data = load_samples()
    tr_idx = [i for i, d in enumerate(data) if not is_val(d[0])]
    va_idx = [i for i, d in enumerate(data) if is_val(d[0])]
    if not va_idx:  # tiny datasets: force at least one val property
        va_idx = [tr_idx.pop()]
    Xtr = torch.stack([data[i][1] for i in tr_idx]); Ytr = torch.stack([data[i][2] for i in tr_idx])
    Xva = torch.stack([data[i][1] for i in va_idx]); Yva = torch.stack([data[i][2] for i in va_idx])
    tr_names = [data[i][0] for i in tr_idx]; va_names = [data[i][0] for i in va_idx]
    print(f"loaded {len(data)} samples -> train {len(tr_idx)} / val {len(va_idx)}")
    print("val properties: " + ", ".join(va_names))

    # Per-class label coverage — surface classes that have no signal to learn.
    print("\nlabel coverage (share of pixels, train split):")
    for ci, c in enumerate(CLASSES):
        frac = Ytr[:, ci].mean().item()
        n_tr = sum(1 for i in range(len(tr_idx)) if Ytr[i, ci].sum() > 0)
        n_va = sum(1 for i in range(len(va_idx)) if Yva[i, ci].sum() > 0)
        warn = "  <-- NO LABELS, model can't learn this class" if n_tr == 0 else ""
        print(f"  {c:12s} {frac:6.2%}  in {n_tr}/{len(tr_idx)} train, {n_va}/{len(va_idx)} val{warn}")

    model = UNet(pretrained=True)
    # Fine-tune: gentler LR on the pretrained encoder than the fresh decoder.
    opt = torch.optim.Adam([
        {"params": model.encoder_parameters(), "lr": 3e-4},
        {"params": model.decoder_parameters(), "lr": 1e-3},
    ])
    n_params = sum(p.numel() for p in model.parameters())

    # Per-class positive weight (from the TRAIN split only) so each minority
    # class isn't drowned by BCE. Cap 40 (very rare classes collapse otherwise).
    pos_weight = torch.empty(len(CLASSES))
    for ci in range(len(CLASSES)):
        pos = Ytr[:, ci].sum().item()
        neg = Ytr[:, ci].numel() - pos
        pos_weight[ci] = min(neg / max(pos, 1), 40.0)
    pw_view = pos_weight.view(1, -1, 1, 1)
    print(f"\nResNet18-UNet params: {n_params/1e6:.2f}M | classes {CLASSES} | "
          f"pos_weight {[round(w, 2) for w in pos_weight.tolist()]} | "
          f"SIZE {SIZE} | BATCH {BATCH} | {EPOCHS} epochs CPU{' (FAST)' if FAST else ''}\n")

    best_score, best_state, best_ep = -1.0, None, 0
    order = list(range(len(tr_idx)))
    for ep in range(1, EPOCHS + 1):
        model.train()
        random.shuffle(order)
        ep_loss, steps = 0.0, 0
        for i0 in range(0, len(order), BATCH):
            batch = order[i0:i0 + BATCH]
            pairs = [augment(Xtr[i], Ytr[i]) for i in batch]
            xb = torch.stack([p[0] for p in pairs])
            yb = torch.stack([p[1] for p in pairs])
            opt.zero_grad()
            logits = model(xb)
            bce = F.binary_cross_entropy_with_logits(logits, yb, pos_weight=pw_view)
            dice = sum(dice_loss(logits[:, ci], yb[:, ci]) for ci in range(len(CLASSES))) / len(CLASSES)
            loss = bce + dice
            loss.backward()
            opt.step()
            ep_loss += loss.item(); steps += 1

        if ep % EVAL_EVERY == 0 or ep == 1 or ep == EPOCHS:
            va_means, _ = evaluate(model, Xva, Yva, va_names)
            scored = [m for m in va_means.values() if m is not None]
            score = float(np.mean(scored)) if scored else -1.0
            marker = ""
            if score > best_score:
                best_score, best_state, best_ep = score, copy.deepcopy(model.state_dict()), ep
                marker = "  <-- best, checkpointed"
            print(f"epoch {ep:3d}  loss {ep_loss/max(steps,1):.4f}  VAL {fmt_means(va_means)}{marker}")

    # Restore the best checkpoint and report both splits with it.
    if best_state is not None:
        model.load_state_dict(best_state)
    tr_means, tr_rows = evaluate(model, Xtr, Ytr, tr_names)
    va_means, va_rows = evaluate(model, Xva, Yva, va_names)
    print(f"\nbest checkpoint (epoch {best_ep}):")
    print(f"  TRAIN {fmt_means(tr_means)}")
    print(f"  VAL   {fmt_means(va_means)}")
    print("\nper-property IoU (VAL — the honest number):")
    for r in va_rows:
        print(r)
    print("\nper-property IoU (train):")
    for r in tr_rows:
        print(r)

    os.makedirs(os.path.join(ROOT, "out"), exist_ok=True)
    torch.save(model.state_dict(), os.path.join(ROOT, "out", "seg_unet.pt"))
    # Record channel->class order + val metrics, for the predictor and for
    # tracking model quality across retrains.
    json.dump(
        {"classes": CLASSES, "val_iou": va_means, "val_properties": va_names,
         "size": SIZE, "epochs": EPOCHS, "best_epoch": best_ep},
        open(os.path.join(ROOT, "out", "seg_classes.json"), "w"),
    )
    print("\nsaved best model -> training-data/out/seg_unet.pt (classes: " + ", ".join(CLASSES) + ")")


if __name__ == "__main__":
    main()
