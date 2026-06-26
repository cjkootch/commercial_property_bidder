"""
Step 2 of the self-training loop: pre-label serviceable areas on unlabeled props.

Reads ml/to_predict.json + ml/predict_in/<id>.jpg (written by dump-unlabeled.ts),
runs the trained multi-class U-Net, clips each predicted class mask to the parcel
(+ small buffer, since parcel lines aren't perfect), vectorizes each into lng/lat
polygons tagged with their kind (turf, tree, …), and writes ml/predictions.json.
seed-predictions.ts then inserts them as editable 'ml_pred' drafts for the
operator to correct.

Run:  python3 ml/predict_turf.py
"""
import json, os
import numpy as np
import cv2
from PIL import Image
import torch
from train_turf import UNet, SIZE, ROOT, CLASSES  # noqa

HERE = os.path.dirname(__file__)
MODEL = os.path.join(ROOT, "out", "seg_unet.pt")
CLASSES_JSON = os.path.join(ROOT, "out", "seg_classes.json")
BUFFER_M = 12.0          # allow predictions up to ~12 m outside the parcel line
MIN_AREA_FRAC = 0.003    # drop blobs smaller than 0.3% of the tile


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


def labeled_mask(fc, b, W, H):
    """Rasterize the operator's already-drawn polygons (any kind) into a 'claimed'
    mask. The predictor fills only where this is 0, so a partially-labeled
    property gets the model's gap-fill without overwriting hand work."""
    m = np.zeros((H, W), np.uint8)
    for f in (fc or {}).get("features", []):
        geom = f.get("geometry") or {}
        if geom.get("type") != "Polygon":
            continue
        rings = geom.get("coordinates") or []
        if not rings:
            continue
        pts = []
        for lng, lat in rings[0]:
            x = (lng - b["minLng"]) / (b["maxLng"] - b["minLng"]) * W
            y = (b["maxLat"] - lat) / (b["maxLat"] - b["minLat"]) * H
            pts.append([x, y])
        cv2.fillPoly(m, [np.array(pts, np.int32)], 1)
    return m


def vectorize(mask, kind, b, W, H, min_area):
    """Turn a binary class mask into kind-tagged GeoJSON polygon features."""
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    feats = []
    for c in contours:
        if cv2.contourArea(c) < min_area:
            continue
        eps = 0.0022 * cv2.arcLength(c, True)  # less rounding -> tighter polygons
        poly = cv2.approxPolyDP(c, eps, True)[:, 0, :]
        if len(poly) < 3:
            continue
        ring = [lnglat(float(px), float(py), b, W, H) for px, py in poly]
        ring.append(ring[0])
        feats.append({
            "type": "Feature",
            "properties": {"kind": kind, "area_sqft": 0},
            "geometry": {"type": "Polygon", "coordinates": [ring]},
        })
    return feats


def main():
    items = json.load(open(os.path.join(HERE, "to_predict.json")))
    # Trust the channel->class order saved alongside the model if present.
    classes = CLASSES
    if os.path.exists(CLASSES_JSON):
        classes = json.load(open(CLASSES_JSON)).get("classes", CLASSES)

    model = UNet(n_classes=len(classes)); model.load_state_dict(torch.load(MODEL)); model.eval()
    out = []
    for it in items:
        pid, name, W, H, b = it["property_id"], it["name"], it["width"], it["height"], it["bbox"]
        img = Image.open(os.path.join(HERE, "predict_in", f"{pid}.jpg")).convert("RGB")
        x = torch.from_numpy(np.asarray(img.resize((SIZE, SIZE), Image.BILINEAR), np.float32) / 255.0).permute(2, 0, 1)[None]
        with torch.no_grad():
            prob = torch.sigmoid(model(x))[0].numpy()  # (C, SIZE, SIZE)

        # Parcel clip mask (shared by every class), dilated by the buffer.
        mpp = ((b["maxLng"] - b["minLng"]) * 111320 * np.cos(np.radians((b["minLat"] + b["maxLat"]) / 2))) / W
        buf_px = int(max(3, min(40, BUFFER_M / max(mpp, 1e-6))))
        pmask = parcel_mask(it["parcel_rings"], b, W, H)
        pmask = cv2.dilate(pmask, np.ones((buf_px * 2 + 1, buf_px * 2 + 1), np.uint8))

        # Gap-fill: where the operator already drew, leave it alone — the model
        # only proposes labels for the un-drawn remainder. A few px of erosion
        # lets gap-fill meet existing edges without a seam.
        gap = None
        existing = it.get("existing_labels")
        if existing and existing.get("features"):
            claimed = labeled_mask(existing, b, W, H)
            claimed = cv2.dilate(claimed, np.ones((5, 5), np.uint8))
            gap = (pmask > 0) & (claimed == 0)

        min_area = MIN_AREA_FRAC * W * H
        feats = []
        per_class = []
        for ci, kind in enumerate(classes):
            pred = (cv2.resize(prob[ci], (W, H), interpolation=cv2.INTER_LINEAR) > 0.5).astype(np.uint8)
            pred = pred & pmask
            if gap is not None:
                pred = pred & gap.astype(np.uint8)
            cf = vectorize(pred, kind, b, W, H, min_area)
            feats.extend(cf)
            per_class.append(f"{len(cf)} {kind}")
        out.append({
            "property_id": pid,
            "name": name,
            "service_areas": {"type": "FeatureCollection", "features": feats},
            "map_view": {
                "center": [(b["minLng"] + b["maxLng"]) / 2, (b["minLat"] + b["maxLat"]) / 2],
                "zoom": 17,
            },
        })
        print(f"  {name:34s} " + ", ".join(per_class))

    json.dump(out, open(os.path.join(HERE, "predictions.json"), "w"))
    print(f"\nwrote {len(out)} predictions -> ml/predictions.json")


if __name__ == "__main__":
    main()
