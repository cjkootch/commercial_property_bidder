# Serviceable-area segmentation (turf + tree ML)

Proof-of-pipeline for detecting mowable turf **and tree canopy** from satellite
tiles, trained on operator-drawn labels.

The model predicts one independent mask per class (`CLASSES = ["turf", "tree"]`
in `train_turf.py`) — sigmoids, not a softmax, so each class has its own
`pos_weight` (turf and tree are different-sized pixel minorities). Tree matters
for the "grass under trees" pricing toggle and for a cleaner grass pre-screen
(the RGB veg % lumps grass and canopy together).

## Pipeline
1. Label properties in the app: draw **Turf** and **Tree** polygons (Building/
   Pavement only if turf was traced as the whole parcel). Each save persists
   `service_areas` polygons.
2. `npm run export:training` → `training-data/` (image + class-index mask per
   property, latest measurement only). The mask already encodes every class;
   the trainer selects the `CLASSES` channels.
3. `python3 ml/train_turf.py` → trains a small U-Net, prints per-class label
   coverage + loss + per-class IoU, saves `training-data/out/seg_unet.pt` and
   `seg_classes.json` (channel→class order).
4. `python3 ml/predict_overlay.py` → writes prediction overlays for QA
   (turf green, tree orange, ground-truth outline yellow).

Install (CPU): `pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu`

**Fast iteration vs. final run.** `SIZE` and `EPOCHS` are env-overridable. While
labeling, iterate quickly; only do the long high-res run for a "final" model:
- `FAST=1 python3 ml/train_turf.py` → SIZE 384 / 80 epochs (~3–4× faster).
- `SIZE=384 EPOCHS=80 python3 ml/train_turf.py` → explicit override.
- `python3 ml/train_turf.py` → defaults SIZE 512 / 250 epochs (slowest, sharpest).

## Status / next steps
- This is a DEMO on a handful of labels — it proves the data + loop learn turf
  and tree, not a production model. A class with no labels is reported as
  `n/a`/`NO LABELS` and simply can't be learned until polygons are drawn.
- To get accurate: (a) label more properties (dozens+), especially small/narrow
  turf and properties with real tree canopy; (b) move to a pretrained backbone
  (e.g. SegFormer) fine-tuned on GPU (Hugging Face); (c) serve inference via an
  endpoint and feed predictions into the map's audit view for correction
  (active learning).

## Self-training / active-learning loop (pre-label new properties)
1. `npm run ml:dump`            # TS: fetch tiles for unlabeled properties -> ml/predict_in + ml/to_predict.json
2. `python3 ml/predict_turf.py` # model -> clip each class to buffered parcel -> vectorize turf+tree -> ml/predictions.json
3. `npm run ml:seed-pred`       # TS: insert predictions as editable 'ml_pred' drafts (turf + tree polygons)
4. Operator opens each property -> corrects the predicted turf/tree -> Save (becomes a clean human label).
5. `npm run export:training` (excludes ml_pred) -> retrain. Each round the drafts get closer.
