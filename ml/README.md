# Turf segmentation (serviceable-area ML)

Proof-of-pipeline for detecting mowable turf from satellite tiles, trained on
operator-drawn labels.

## Pipeline
1. Label properties in the app (draw Turf; Building/Pavement only if turf was
   traced as the whole parcel). Each save persists `service_areas` polygons.
2. `npm run export:training` → `training-data/` (image + class-index mask per
   property, latest measurement only). Binary target here = turf vs. everything.
3. `python3 ml/train_turf.py` → trains a small U-Net, prints loss + turf-IoU,
   saves `training-data/out/turf_unet.pt`.
4. `python3 ml/predict_overlay.py` → writes prediction overlays for QA.

Install (CPU): `pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu`

## Status / next steps
- This is a DEMO on a handful of labels — it proves the data + loop learn turf,
  not a production model.
- To get accurate: (a) label more properties (dozens+), especially small/narrow
  turf cases; (b) move to a pretrained backbone (e.g. SegFormer) fine-tuned on
  GPU (Hugging Face); (c) serve inference via an endpoint and feed predictions
  into the map's audit view for correction (active learning).
