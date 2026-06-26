"""Render model predictions on UNLABELED tiles for visual QA (no ground truth).
Reads ml/to_predict.json + ml/predict_in/<id>.jpg, runs the model, clips each
class to the buffered parcel (same as predict_turf), and writes a side-by-side
satellite | overlay PNG per property to ml/predict_in/preview/.

Run:  cd ml && python3 preview_predictions.py
"""
import json, os
import numpy as np
import cv2
from PIL import Image
import torch
from train_turf import UNet, SIZE, ROOT, CLASSES  # noqa
from predict_turf import parcel_mask, BUFFER_M

HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, "predict_in", "preview")
os.makedirs(OUT, exist_ok=True)
COLORS = {"turf": (0, 153, 60), "sports_turf": (22, 200, 80), "tree": (230, 126, 34),
          "bed": (155, 89, 182), "building": (149, 165, 166), "pavement": (90, 90, 90),
          "other": (52, 152, 219)}


def main():
    items = json.load(open(os.path.join(HERE, "to_predict.json")))
    cj = os.path.join(ROOT, "out", "seg_classes.json")
    classes = json.load(open(cj)).get("classes", CLASSES) if os.path.exists(cj) else CLASSES
    model = UNet(n_classes=len(classes)); model.load_state_dict(torch.load(os.path.join(ROOT, "out", "seg_unet.pt"))); model.eval()

    for it in items:
        pid, name, W, H, b = it["property_id"], it["name"], it["width"], it["height"], it["bbox"]
        img = Image.open(os.path.join(HERE, "predict_in", f"{pid}.jpg")).convert("RGB")
        base = np.asarray(img, np.uint8)
        x = torch.from_numpy(np.asarray(img.resize((SIZE, SIZE), Image.BILINEAR), np.float32) / 255.0).permute(2, 0, 1)[None]
        with torch.no_grad():
            prob = torch.sigmoid(model(x))[0].numpy()

        mpp = ((b["maxLng"] - b["minLng"]) * 111320 * np.cos(np.radians((b["minLat"] + b["maxLat"]) / 2))) / W
        buf_px = int(max(3, min(40, BUFFER_M / max(mpp, 1e-6))))
        pmask = cv2.dilate(parcel_mask(it["parcel_rings"], b, W, H), np.ones((buf_px * 2 + 1,) * 2, np.uint8))

        overlay = base.copy()
        for ci, kind in enumerate(classes):
            pred = (cv2.resize(prob[ci], (W, H), interpolation=cv2.INTER_LINEAR) > 0.5).astype(np.uint8) & pmask
            col = np.array(COLORS.get(kind, (0, 153, 60)))
            overlay[pred > 0] = (0.45 * overlay[pred > 0] + col * 0.55).astype(np.uint8)
        # draw parcel outline (white) for context
        pm = parcel_mask(it["parcel_rings"], b, W, H)
        edge = (np.abs(np.gradient(pm.astype(float))[0]) + np.abs(np.gradient(pm.astype(float))[1])) > 0
        overlay[edge] = (255, 255, 255)

        strip = np.concatenate([base, overlay], axis=1)
        safe = "".join(c if c.isalnum() else "_" for c in name)[:40]
        Image.fromarray(strip).save(os.path.join(OUT, f"{safe}.png"))
        print("wrote", name)


if __name__ == "__main__":
    main()
