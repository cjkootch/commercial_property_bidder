"""
Step 2 of the self-training loop: pre-label turf on unlabeled properties.

Reads ml/to_predict.json + ml/predict_in/<id>.jpg (written by dump-unlabeled.ts),
runs the trained U-Net, clips the prediction to the parcel (+ small buffer, since
parcel lines aren't perfect), vectorizes the turf mask into lng/lat polygons, and
writes ml/predictions.json. seed-predictions.ts then inserts them as editable
'ml_pred' drafts for the operator to correct.

Run:  python3 ml/predict_turf.py
"""
import json, os
import numpy as np
import cv2
from PIL import Image
import torch
from train_turf import UNet, SIZE, ROOT, TURF_CLASS  # noqa

HERE = os.path.dirname(__file__)
MODEL = os.path.join(ROOT, "out", "turf_unet.pt")
BUFFER_M = 12.0          # allow predictions up to ~12 m outside the parcel line
MIN_AREA_FRAC = 0.003    # drop turf blobs smaller than 0.3% of the tile


def lnglat(px, py, b, W, H):
    lng = b["minLng"] + (px + 0.5) / W * (b["maxLng"] - b["minLng"])
    lat = b["maxLat"] - (py + 0.5) / H * (b["maxLat"] - b["minLat"])
    return [lng, lat]


def parcel_mask(rings, b, W, H):
    m = np.zeros((H, W), np.uint8)
    for ring in rings:
        pts = []
        for lng, lat in ring:
            x = (lng - b["minLng"]) / (b["maxLng"] - b["minLng"]) * W
            y = (b["maxLat"] - lat) / (b["maxLat"] - b["minLat"]) * H
            pts.append([x, y])
        cv2.fillPoly(m, [np.array(pts, np.int32)], 1)
    return m


def main():
    items = json.load(open(os.path.join(HERE, "to_predict.json")))
    model = UNet(); model.load_state_dict(torch.load(MODEL)); model.eval()
    out = []
    for it in items:
        pid, name, W, H, b = it["property_id"], it["name"], it["width"], it["height"], it["bbox"]
        img = Image.open(os.path.join(HERE, "predict_in", f"{pid}.jpg")).convert("RGB")
        x = torch.from_numpy(np.asarray(img.resize((SIZE, SIZE), Image.BILINEAR), np.float32) / 255.0).permute(2, 0, 1)[None]
        with torch.no_grad():
            prob = torch.sigmoid(model(x))[0, 0].numpy()
        pred = (cv2.resize(prob, (W, H), interpolation=cv2.INTER_LINEAR) > 0.5).astype(np.uint8)

        # Clip to parcel + buffer.
        mpp = ((b["maxLng"] - b["minLng"]) * 111320 * np.cos(np.radians((b["minLat"] + b["maxLat"]) / 2))) / W
        buf_px = int(max(3, min(40, BUFFER_M / max(mpp, 1e-6))))
        pmask = parcel_mask(it["parcel_rings"], b, W, H)
        pmask = cv2.dilate(pmask, np.ones((buf_px * 2 + 1, buf_px * 2 + 1), np.uint8))
        pred = pred & pmask

        # Vectorize.
        contours, _ = cv2.findContours(pred, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        min_area = MIN_AREA_FRAC * W * H
        feats = []
        for c in contours:
            if cv2.contourArea(c) < min_area:
                continue
            eps = 0.004 * cv2.arcLength(c, True)
            poly = cv2.approxPolyDP(c, eps, True)[:, 0, :]
            if len(poly) < 3:
                continue
            ring = [lnglat(float(px), float(py), b, W, H) for px, py in poly]
            ring.append(ring[0])
            feats.append({
                "type": "Feature",
                "properties": {"kind": "turf", "area_sqft": 0},
                "geometry": {"type": "Polygon", "coordinates": [ring]},
            })
        out.append({
            "property_id": pid,
            "name": name,
            "service_areas": {"type": "FeatureCollection", "features": feats},
            "map_view": {
                "center": [(b["minLng"] + b["maxLng"]) / 2, (b["minLat"] + b["maxLat"]) / 2],
                "zoom": 17,
            },
        })
        print(f"  {name:34s} {len(feats)} turf polygon(s)")

    json.dump(out, open(os.path.join(HERE, "predictions.json"), "w"))
    print(f"\nwrote {len(out)} predictions -> ml/predictions.json")


if __name__ == "__main__":
    main()
