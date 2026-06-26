"""Render the trained model's predictions for visual inspection.
Writes <property>.png to training-data/out/: satellite | predicted overlay
(turf green, tree orange) | with ground-truth outlines (yellow) per class."""
import json, os, numpy as np
from PIL import Image
import torch
from train_turf import UNet, load_samples, SIZE, ROOT, CLASSES

# Overlay color per class (RGB).
COLORS = {"turf": (0, 153, 60), "sports_turf": (22, 200, 80), "tree": (230, 126, 34),
          "bed": (155, 89, 182), "building": (149, 165, 166), "pavement": (90, 90, 90),
          "other": (52, 152, 219)}


def main():
    classes_path = os.path.join(ROOT, "out", "seg_classes.json")
    classes = json.load(open(classes_path)).get("classes", CLASSES) if os.path.exists(classes_path) else CLASSES
    data = load_samples()
    model = UNet(n_classes=len(classes))
    model.load_state_dict(torch.load(os.path.join(ROOT, "out", "seg_unet.pt")))
    model.eval()
    X = torch.stack([d[1] for d in data])
    with torch.no_grad():
        pred = (torch.sigmoid(model(X)) > 0.5).float().numpy()  # (N, C, H, W)
    for i, (name, x, y) in enumerate(data):
        base = (x.permute(1, 2, 0).numpy() * 255).astype(np.uint8).copy()
        overlay = base.copy()
        gt = y.numpy()  # (C, H, W)
        for ci, c in enumerate(classes):
            pr = pred[i, ci]
            col = np.array(COLORS.get(c, (0, 153, 60)))
            overlay[pr > 0.5] = (0.45 * overlay[pr > 0.5] + col * 0.55).astype(np.uint8)
        # ground-truth outlines (yellow) for every labeled class
        for ci in range(len(classes)):
            g = gt[ci]
            if g.sum() == 0:
                continue
            edge = (np.abs(np.gradient(g)[0]) + np.abs(np.gradient(g)[1])) > 0
            overlay[edge] = (255, 221, 0)
        strip = np.concatenate([base, overlay], axis=1)
        Image.fromarray(strip).save(os.path.join(ROOT, "out", f"{name.replace(' ', '_')}.png"))
        print("wrote", name)


if __name__ == "__main__":
    main()
