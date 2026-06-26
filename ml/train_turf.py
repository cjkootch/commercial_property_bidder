"""
Serviceable-area segmentation — proof-of-training on hand-drawn labels.

Trains a small U-Net to predict per-class masks from a satellite tile. The
output has one channel per class in CLASSES (independent sigmoids, NOT a softmax)
so a pixel can be turf OR tree and the classes are learned with their own
pos_weight — important because each is a different-sized pixel minority.

Currently CLASSES = ["turf", "tree", "building", "pavement"]:
  - turf      drives the mowable-area price.
  - tree      separates canopy from grass (the "grass under trees" toggle, and a
              cleaner grass pre-screen — RGB veg % lumps the two together).
  - building  } subtracted from turf to get the geometric mowable area, so the
  - pavement  } self-training drafts are complete enough to price without hand work.
(bed is also subtracted from turf but has no labels yet — add it to CLASSES once
 properties carry bed polygons.)

This is a DEMO on a handful of samples to show the pipeline learns — not a
production model (that needs dozens+ of labeled properties, and in particular
properties where the operator has actually drawn TREE polygons).

Usage:
  npm run export:training          # produce training-data/
  python3 ml/train_turf.py         # train + report loss/IoU per class
"""
import json
import os
import random
import numpy as np
from PIL import Image
import torch
import torch.nn as nn
import torch.nn.functional as F

ROOT = os.path.join(os.path.dirname(__file__), "..", "training-data")
SIZE = 256
EPOCHS = 250
SEED = 0

# Classes the model predicts, in output-channel order, mapped to the class-index
# the exporter writes into the mask (lib/geo/raster CLASS_INDEX).
CLASSES = ["turf", "sports_turf", "tree", "building", "pavement"]
CLASS_IDS = {"turf": 1, "bed": 2, "tree": 3, "building": 4, "pavement": 5, "other": 6, "sports_turf": 7}
# Back-compat alias (older predict scripts imported TURF_CLASS).
TURF_CLASS = CLASS_IDS["turf"]

random.seed(SEED); np.random.seed(SEED); torch.manual_seed(SEED)


def load_samples():
    items = []
    with open(os.path.join(ROOT, "metadata.jsonl")) as f:
        for line in f:
            r = json.loads(line)
            img = Image.open(os.path.join(ROOT, r["file_name"])).convert("RGB").resize((SIZE, SIZE), Image.BILINEAR)
            m = Image.open(os.path.join(ROOT, r["mask"])).convert("RGB").resize((SIZE, SIZE), Image.NEAREST)
            x = torch.from_numpy(np.asarray(img, dtype=np.float32) / 255.0).permute(2, 0, 1)
            mask_cls = np.asarray(m)[:, :, 0]  # class id stored in R channel
            # One binary plane per class -> (C, H, W).
            planes = [(mask_cls == CLASS_IDS[c]).astype(np.float32) for c in CLASSES]
            y = torch.from_numpy(np.stack(planes, axis=0))
            items.append((r["property"], x, y))
    return items


class UNet(nn.Module):
    def __init__(s, c=16, n_classes=len(CLASSES)):
        super().__init__()
        def blk(i, o): return nn.Sequential(nn.Conv2d(i, o, 3, padding=1), nn.ReLU(), nn.Conv2d(o, o, 3, padding=1), nn.ReLU())
        s.e1, s.e2, s.e3 = blk(3, c), blk(c, c * 2), blk(c * 2, c * 4)
        s.p = nn.MaxPool2d(2)
        s.d2, s.d1 = blk(c * 4 + c * 2, c * 2), blk(c * 2 + c, c)
        s.out = nn.Conv2d(c, n_classes, 1)

    def forward(s, x):
        e1 = s.e1(x); e2 = s.e2(s.p(e1)); e3 = s.e3(s.p(e2))
        d2 = s.d2(torch.cat([F.interpolate(e3, scale_factor=2, mode="bilinear", align_corners=False), e2], 1))
        d1 = s.d1(torch.cat([F.interpolate(d2, scale_factor=2, mode="bilinear", align_corners=False), e1], 1))
        return s.out(d1)


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


def main():
    data = load_samples()
    print(f"loaded {len(data)} samples: {[d[0] for d in data]}")
    X = torch.stack([d[1] for d in data])
    Y = torch.stack([d[2] for d in data])  # (N, C, H, W)

    # Per-class label coverage — surface classes that have no signal to learn.
    print("\nlabel coverage (share of pixels):")
    for ci, c in enumerate(CLASSES):
        frac = Y[:, ci].mean().item()
        props = sum(1 for i in range(len(data)) if Y[i, ci].sum() > 0)
        warn = "  <-- NO LABELS, model can't learn this class" if props == 0 else ""
        print(f"  {c:8s} {frac:6.2%}  in {props}/{len(data)} properties{warn}")

    model = UNet()
    opt = torch.optim.Adam(model.parameters(), lr=1e-3)
    n_params = sum(p.numel() for p in model.parameters())

    # Per-class positive weight so each minority class isn't drowned by BCE.
    pos_weight = torch.empty(len(CLASSES))
    for ci in range(len(CLASSES)):
        pos = Y[:, ci].sum().item()
        neg = Y[:, ci].numel() - pos
        pos_weight[ci] = min(neg / max(pos, 1), 10.0)
    pw_view = pos_weight.view(1, -1, 1, 1)
    print(f"\nU-Net params: {n_params/1e6:.2f}M | classes {CLASSES} | "
          f"pos_weight {[round(w,2) for w in pos_weight.tolist()]} | {EPOCHS} epochs CPU\n")

    for ep in range(1, EPOCHS + 1):
        model.train()
        # simple flip augmentation (flip W=dim3 / H=dim2 on both image and mask)
        xb, yb = X.clone(), Y.clone()
        if random.random() < 0.5: xb, yb = xb.flip(3), yb.flip(3)
        if random.random() < 0.5: xb, yb = xb.flip(2), yb.flip(2)
        opt.zero_grad()
        logits = model(xb)
        bce = F.binary_cross_entropy_with_logits(logits, yb, pos_weight=pw_view)
        dice = sum(dice_loss(logits[:, ci], yb[:, ci]) for ci in range(len(CLASSES))) / len(CLASSES)
        loss = bce + dice
        loss.backward(); opt.step()
        if ep % 10 == 0 or ep == 1:
            model.eval()
            with torch.no_grad():
                tr = model(X)
            line = f"epoch {ep:3d}  loss {loss.item():.4f}"
            for ci, c in enumerate(CLASSES):
                vals = [iou(tr[i, ci:ci+1], Y[i, ci:ci+1]) for i in range(len(data))]
                vals = [v for v in vals if v is not None]
                line += f"  {c}-IoU {np.mean(vals):.3f}" if vals else f"  {c}-IoU  n/a"
            print(line)

    # per-property, per-class final IoU
    model.eval()
    with torch.no_grad():
        pred = model(X)
    print("\nfinal per-property IoU:")
    for i, (name, _, _) in enumerate(data):
        parts = []
        for ci, c in enumerate(CLASSES):
            v = iou(pred[i, ci:ci+1], Y[i, ci:ci+1])
            parts.append(f"{c} {v:.3f}" if v is not None else f"{c}  n/a")
        print(f"  {name:34s} " + "  ".join(parts))

    os.makedirs(os.path.join(ROOT, "out"), exist_ok=True)
    torch.save(model.state_dict(), os.path.join(ROOT, "out", "seg_unet.pt"))
    # Record which classes each channel corresponds to, for the predictor.
    json.dump({"classes": CLASSES}, open(os.path.join(ROOT, "out", "seg_classes.json"), "w"))
    print("\nsaved model -> training-data/out/seg_unet.pt (classes: " + ", ".join(CLASSES) + ")")


if __name__ == "__main__":
    main()
