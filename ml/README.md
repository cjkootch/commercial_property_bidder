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

## Training rigor (v2)
- **Pretrained ResNet18 encoder** (ImageNet) fine-tuned with a gentler LR than
  the fresh decoder; per-sample flip/rotate augmentation; mini-batch training.
- **Deterministic train/val split** (~20% by property-name hash). The reported
  **VAL IoU is the honest number** — train IoU measures memorization. The split
  is stable across runs, so numbers are comparable as labels accumulate.
- **Best-checkpoint saving**: `seg_unet.pt` is the epoch with the best mean val
  IoU (not the last epoch). `seg_classes.json` records the val metrics per run.

**Fast iteration vs. final run.** `SIZE`/`EPOCHS`/`BATCH` are env-overridable.
An "epoch" is a full mini-batched pass (several optimizer steps), so far fewer
epochs are needed than the old one-step-per-epoch trainer:
- `FAST=1 python3 ml/train_turf.py` → SIZE 384 / 30 epochs (iterate while labeling).
- `python3 ml/train_turf.py` → defaults SIZE 512 / 60 epochs (final model).

## Confidence gate (autonomy)
`predict_turf.py` scores each property: sigmoid **margin** inside the parcel
(0 = coin-flip, 1 = certain) + the model's vegetation fraction.
`seed-predictions.ts` upgrades a draft to **Med** confidence only when the model
is decisive (margin ≥ 0.75) **and** agrees with the independent RGB vegetation
fraction (±15%); otherwise the draft stays **Low**, which sets `needs_review` in
the pricing engine. "High" is reserved for human labels. This is the gate that
lets confident measurements flow toward autonomous quoting while routing the
rest to a human.

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
