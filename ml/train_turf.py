"""
Turf serviceable-area segmentation — proof-of-training on hand-drawn labels.

Trains a small U-Net to predict the mowable-turf mask from a satellite tile.
Binary target: turf (class 1 in the exported mask) vs everything else. This is
a DEMO on a handful of samples to show the pipeline learns — not a production
model (that needs dozens+ of labeled properties).

Usage:
  npm run export:training          # produce training-data/
  python3 ml/train_turf.py         # train + report loss/IoU per epoch
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
TURF_CLASS = 1
EPOCHS = 250
SEED = 0

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
            y = torch.from_numpy((mask_cls == TURF_CLASS).astype(np.float32))[None]
            items.append((r["property"], x, y))
    return items


class UNet(nn.Module):
    def __init__(s, c=16):
        super().__init__()
        def blk(i, o): return nn.Sequential(nn.Conv2d(i, o, 3, padding=1), nn.ReLU(), nn.Conv2d(o, o, 3, padding=1), nn.ReLU())
        s.e1, s.e2, s.e3 = blk(3, c), blk(c, c * 2), blk(c * 2, c * 4)
        s.p = nn.MaxPool2d(2)
        s.d2, s.d1 = blk(c * 4 + c * 2, c * 2), blk(c * 2 + c, c)
        s.out = nn.Conv2d(c, 1, 1)

    def forward(s, x):
        e1 = s.e1(x); e2 = s.e2(s.p(e1)); e3 = s.e3(s.p(e2))
        d2 = s.d2(torch.cat([F.interpolate(e3, scale_factor=2, mode="bilinear", align_corners=False), e2], 1))
        d1 = s.d1(torch.cat([F.interpolate(d2, scale_factor=2, mode="bilinear", align_corners=False), e1], 1))
        return s.out(d1)


def iou(logits, y):
    p = (torch.sigmoid(logits) > 0.5).float()
    inter = (p * y).sum().item()
    union = ((p + y) > 0).float().sum().item()
    return inter / union if union else 1.0


def main():
    data = load_samples()
    print(f"loaded {len(data)} samples: {[d[0] for d in data]}\n")
    X = torch.stack([d[1] for d in data])
    Y = torch.stack([d[2] for d in data])

    model = UNet()
    opt = torch.optim.Adam(model.parameters(), lr=1e-3)
    n_params = sum(p.numel() for p in model.parameters())
    # Turf is a pixel minority -> weight positives so the model doesn't collapse
    # to "no turf everywhere" (which minimizes plain BCE but gives 0 IoU).
    pos = Y.sum().item(); neg = Y.numel() - pos
    pos_weight = torch.tensor([min(neg / max(pos, 1), 10.0)])
    print(f"U-Net params: {n_params/1e6:.2f}M | pos_weight {pos_weight.item():.2f} | {EPOCHS} epochs CPU\n")

    def dice_loss(logits, y):
        p = torch.sigmoid(logits)
        num = 2 * (p * y).sum() + 1
        den = p.sum() + y.sum() + 1
        return 1 - num / den

    for ep in range(1, EPOCHS + 1):
        model.train()
        # simple flip augmentation
        xb, yb = X.clone(), Y.clone()
        if random.random() < 0.5: xb, yb = xb.flip(3), yb.flip(3)
        if random.random() < 0.5: xb, yb = xb.flip(2), yb.flip(2)
        opt.zero_grad()
        logits = model(xb)
        loss = F.binary_cross_entropy_with_logits(logits, yb, pos_weight=pos_weight) + dice_loss(logits, yb)
        loss.backward(); opt.step()
        if ep % 10 == 0 or ep == 1:
            model.eval()
            with torch.no_grad():
                tr = model(X)
                m_iou = np.mean([iou(tr[i:i+1], Y[i:i+1]) for i in range(len(data))])
            print(f"epoch {ep:3d}  loss {loss.item():.4f}  train turf-IoU {m_iou:.3f}")

    # per-property final IoU
    model.eval()
    with torch.no_grad():
        pred = model(X)
    print("\nfinal per-property turf-IoU:")
    for i, (name, _, _) in enumerate(data):
        print(f"  {name:34s} {iou(pred[i:i+1], Y[i:i+1]):.3f}")
    os.makedirs(os.path.join(ROOT, "out"), exist_ok=True)
    torch.save(model.state_dict(), os.path.join(ROOT, "out", "turf_unet.pt"))
    print("\nsaved model -> training-data/out/turf_unet.pt")


if __name__ == "__main__":
    main()
