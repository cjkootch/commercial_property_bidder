# Turf-model inference service — ready for a Hugging Face Docker Space (or any
# container host). Build context = this ml/ directory.
#
# HF Space setup:
#   1. Create a Space -> Docker -> private.
#   2. Upload the contents of ml/ (this Dockerfile at the Space root) PLUS your
#      trained weights as  weights/seg_unet.pt  and  weights/seg_classes.json.
#   3. In Vercel: TURF_MODEL_URL=https://<user>-<space>.hf.space and
#      TURF_MODEL_KEY=<your hf_ token> (private Space -> HF's own auth gates it;
#      leave TURF_MODEL_KEY unset in the Space itself).

FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    --extra-index-url https://download.pytorch.org/whl/cpu

COPY . .

# Weights live alongside the code in the Space repo (upload them to weights/).
ENV TURF_MODEL_PATH=/app/weights/seg_unet.pt \
    TURF_CLASSES_PATH=/app/weights/seg_classes.json

# HF Docker Spaces route traffic to port 7860.
EXPOSE 7860
CMD ["uvicorn", "serve:app", "--host", "0.0.0.0", "--port", "7860"]
