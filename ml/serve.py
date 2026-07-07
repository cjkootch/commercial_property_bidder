"""
HTTP inference service for the turf segmentation model — so the app can
auto-draft service-area polygons the moment a property's parcel resolves,
with no laptop involved.

Deploy anywhere Python runs (a $5 VPS, a Hugging Face Docker Space, Fly.io):
  1. Copy the repo's ml/ directory + your trained weights (out/seg_unet.pt and
     out/seg_classes.json). Set TURF_MODEL_PATH if the weights live elsewhere.
  2. pip install -r ml/requirements.txt
  3. TURF_MODEL_KEY=<secret> uvicorn serve:app --host 0.0.0.0 --port 8000
     (run from the ml/ directory)
  4. In Vercel, set TURF_MODEL_URL=https://<your-host> and the same
     TURF_MODEL_KEY. The app auto-drafts on first open of any measured-less
     property with a parcel.

Contract:
  GET  /         -> {ok, model_loaded, classes}
  POST /predict  -> body {image_b64, width, height, bbox, parcel_rings,
                          existing_labels?}
                    resp {features, confidence, error?}
The app sends the SAME parcel-fit satellite tile it already fetches for the
vegetation estimate; the service never needs a Mapbox token.
"""
import base64
import io
import os
import threading

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel
from PIL import Image

from predict_turf import load_model, predict_tile

app = FastAPI(title="Greenkeep turf model")

_lock = threading.Lock()
_state: dict = {"model": None, "classes": None, "error": None}


def _ensure_model():
    """Lazy, once. A missing checkpoint surfaces in /(health) and /predict."""
    with _lock:
        if _state["model"] is None and _state["error"] is None:
            try:
                model, classes = load_model()
                _state["model"], _state["classes"] = model, classes
            except Exception as e:  # noqa: BLE001 — report, don't crash the server
                _state["error"] = str(e)
    return _state


class PredictBody(BaseModel):
    image_b64: str
    width: int
    height: int
    bbox: dict  # {minLng, minLat, maxLng, maxLat}
    parcel_rings: list  # [[[lng, lat], ...], ...]
    existing_labels: dict | None = None  # FeatureCollection the model must not overwrite


def _check_auth(authorization: str | None):
    key = os.environ.get("TURF_MODEL_KEY")
    if not key:
        return  # auth disabled (e.g. private network / local dev)
    if authorization != f"Bearer {key}":
        raise HTTPException(status_code=401, detail="bad or missing bearer token")


@app.get("/")
def health():
    s = _ensure_model()
    return {
        "ok": s["error"] is None,
        "model_loaded": s["model"] is not None,
        "classes": s["classes"],
        "error": s["error"],
    }


@app.post("/predict")
def predict(body: PredictBody, authorization: str | None = Header(default=None)):
    _check_auth(authorization)
    s = _ensure_model()
    if s["model"] is None:
        raise HTTPException(status_code=503, detail=f"model not loaded: {s['error']}")
    try:
        img = Image.open(io.BytesIO(base64.b64decode(body.image_b64))).convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="image_b64 is not a decodable image")
    feats, confidence = predict_tile(
        s["model"],
        s["classes"],
        img,
        body.width,
        body.height,
        body.bbox,
        body.parcel_rings,
        body.existing_labels,
    )
    return {"features": feats, "confidence": confidence}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
