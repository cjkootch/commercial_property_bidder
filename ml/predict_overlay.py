"""Render the trained model's turf predictions for visual inspection.
Writes <property>.png to training-data/out/: satellite | predicted turf (green) |
ground-truth turf (yellow outline)."""
import json, os, numpy as np
from PIL import Image
import torch
from train_turf import UNet, load_samples, SIZE, ROOT

def main():
    data = load_samples()
    model = UNet(); model.load_state_dict(torch.load(os.path.join(ROOT, "out", "turf_unet.pt"))); model.eval()
    X = torch.stack([d[1] for d in data])
    with torch.no_grad():
        pred = (torch.sigmoid(model(X)) > 0.5).float().numpy()[:, 0]
    for i, (name, x, y) in enumerate(data):
        base = (x.permute(1, 2, 0).numpy() * 255).astype(np.uint8).copy()
        gt = y.numpy()[0]; pr = pred[i]
        overlay = base.copy()
        overlay[pr > 0.5] = (0.4 * overlay[pr > 0.5] + np.array([0, 153, 60]) * 0.6).astype(np.uint8)  # pred turf green
        # ground-truth outline (yellow): edge of gt
        edge = (np.abs(np.gradient(gt)[0]) + np.abs(np.gradient(gt)[1])) > 0
        overlay[edge] = (255, 221, 0)
        strip = np.concatenate([base, overlay], axis=1)
        Image.fromarray(strip).save(os.path.join(ROOT, "out", f"{name.replace(' ', '_')}.png"))
        print("wrote", name)

if __name__ == "__main__":
    main()
