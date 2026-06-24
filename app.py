import io
import os
import shutil
import uuid
import zipfile
from datetime import datetime
from typing import Any

# Must be set before any ML library is imported to prevent TF from loading
# (TF crashes on arm64 macOS with Python 3.13 due to a mutex bug).
os.environ.setdefault("USE_TF", "0")
os.environ.setdefault("USE_TORCH", "1")

import numpy as np
import matplotlib
from dotenv import load_dotenv

try:
    import cv2
except ImportError:
    cv2 = None

try:
    import matplotlib.pyplot as plt
except Exception:
    plt = None

try:
    import nibabel as nib
except ImportError:
    nib = None

try:
    import keras
    import tensorflow as tf
    print(f"TF {tf.__version__} / Keras {keras.__version__} loaded OK")
except Exception as e:
    print(f"TF/Keras unavailable: {e}")
    keras = None
    tf = None
from fastapi import Depends, FastAPI, File, Form, Request, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from PIL import Image
from werkzeug.utils import secure_filename

load_dotenv()

# Prevent Tkinter issues from Matplotlib.
matplotlib.use("Agg")

# Auth + DB (imported after load_dotenv so env vars are set)
from auth import get_current_user, require_role  # noqa: E402
from db import supabase_admin  # noqa: E402

try:
    from transformers import pipeline
except ImportError:
    pipeline = None

try:
    from groq import Groq
except ImportError:
    Groq = None

app = FastAPI()

# Mount route modules
from routes.patients import router as patients_router  # noqa: E402
from routes.scans import router as scans_router  # noqa: E402
from routes.documents import router as documents_router  # noqa: E402
from routes.chat import router as chat_router  # noqa: E402

app.include_router(patients_router)
app.include_router(scans_router)
app.include_router(documents_router)
app.include_router(chat_router)

UPLOAD_FOLDER = "uploads"
OUTPUT_FOLDER = os.path.join("static", "outputs")
MODEL_PATH = "model/model_x1_1.h5"
IMG_SIZE = 128

SERVER_HOST = os.getenv("SERVER_HOST", "127.0.0.1")
SERVER_PORT = int(os.getenv("SERVER_PORT", "5000"))
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.1-8b-instant").strip()
HF_TOKEN = os.getenv("HF_TOKEN", "").strip() or None
HF_MODEL_ID = os.getenv("HF_MODEL_ID", "Ridwan/Brain-tumor-classification-MRI").strip()
HF_FALLBACK_MODEL_ID = os.getenv(
    "HF_FALLBACK_MODEL_ID", "NeuronZero/MRI-Reader"
).strip()

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(OUTPUT_FOLDER, exist_ok=True)

app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

templates = Jinja2Templates(directory="templates")

latest_analysis: dict[str, Any] = {}


def clear_output_folder() -> None:
    for entry in os.listdir(OUTPUT_FOLDER):
        entry_path = os.path.join(OUTPUT_FOLDER, entry)
        if os.path.isdir(entry_path):
            shutil.rmtree(entry_path, ignore_errors=True)
        else:
            os.remove(entry_path)


def sanitize_upload_name(filename: str | None) -> str:
    safe_name = secure_filename(filename or "")
    if not safe_name:
        safe_name = "uploaded_scan.nii"

    stem, ext = os.path.splitext(safe_name)
    timestamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    return f"{stem}_{timestamp}{ext}"


def load_segmentation_model():
    if not keras or not tf:
        print("Segmentation model skipped: keras/tensorflow unavailable on this platform")
        return None
    print(f"Loading segmentation model from: {MODEL_PATH}")
    try:
        return keras.models.load_model(
            MODEL_PATH,
            custom_objects={
                "accuracy": tf.keras.metrics.MeanIoU(num_classes=4),
                "dice_coef": lambda y_true, y_pred: tf.keras.backend.sum(y_true * y_pred),
                "precision": tf.keras.metrics.Precision(),
                "sensitivity": tf.keras.metrics.Recall(),
                "specificity": tf.keras.metrics.SpecificityAtSensitivity(0.5),
                "dice_coef_necrotic": lambda y_true, y_pred: tf.keras.backend.sum(y_true * y_pred),
                "dice_coef_edema": lambda y_true, y_pred: tf.keras.backend.sum(y_true * y_pred),
                "dice_coef_enhancing": lambda y_true, y_pred: tf.keras.backend.sum(y_true * y_pred),
            },
            compile=False,
        )
    except Exception as exc:
        print(f"Segmentation model failed to load: {exc}")
        return None


def load_classifier_pipeline():
    if not pipeline:
        return None, None, "transformers is not installed"

    model_candidates = []
    for model_id in [HF_MODEL_ID, HF_FALLBACK_MODEL_ID]:
        if model_id and model_id not in model_candidates:
            model_candidates.append(model_id)

    last_error = None
    for model_id in model_candidates:
        try:
            print(f"Loading Hugging Face classifier: {model_id}")
            classifier_pipe = pipeline(
                "image-classification",
                model=model_id,
                token=HF_TOKEN,
                device=-1,
            )
            return classifier_pipe, model_id, None
        except Exception as exc:
            last_error = f"{model_id}: {exc}"
            print(f"Classifier load failed for {model_id}: {exc}")

    return None, None, last_error


segmentation_model = load_segmentation_model()
classifier, classifier_model_id, classifier_error = load_classifier_pipeline()
groq_client = Groq(api_key=GROQ_API_KEY) if Groq and GROQ_API_KEY else None


def calculate_metrics(predictions: np.ndarray) -> dict[str, Any] | None:
    try:
        pred_flat = predictions.flatten()
        tumor_pixels = int(np.sum(pred_flat > 0))
        total_pixels = int(pred_flat.size)
        tumor_percentage = round((tumor_pixels / total_pixels) * 100, 2) if total_pixels else 0

        return {
            "tumor_percentage": tumor_percentage,
            "necrotic_pixels": int(np.sum(pred_flat == 1)),
            "edema_pixels": int(np.sum(pred_flat == 2)),
            "enhancing_pixels": int(np.sum(pred_flat == 3)),
            "total_tumor_pixels": tumor_pixels,
            "total_pixels": total_pixels,
        }
    except Exception as exc:
        print(f"Metric calculation failed: {exc}")
        return None


def normalize_slice_for_classifier(slice_data: np.ndarray) -> Image.Image:
    slice_min = float(np.min(slice_data))
    slice_max = float(np.max(slice_data))
    if slice_max > slice_min:
        normalized = (slice_data - slice_min) / (slice_max - slice_min)
    else:
        normalized = np.zeros_like(slice_data)

    uint8_image = (normalized * 255).astype(np.uint8)
    return Image.fromarray(uint8_image).convert("RGB")


def normalize_label(label: str) -> str:
    return label.replace("_", " ").replace("-", " ").title()


def build_classification_result(
    volume_batch: np.ndarray, predictions: np.ndarray
) -> dict[str, Any] | None:
    if not classifier:
        return {
            "available": False,
            "model_id": classifier_model_id,
            "error": classifier_error or "classifier unavailable",
        }

    try:
        tumor_by_slice = np.sum(predictions > 0, axis=(1, 2))
        representative_index = int(np.argmax(tumor_by_slice))
        if int(tumor_by_slice[representative_index]) == 0:
            representative_index = len(volume_batch) // 2

        image = normalize_slice_for_classifier(volume_batch[representative_index, :, :, 0])
        results = classifier(image, top_k=4)
        top_prediction = results[0]
        raw_label = top_prediction["label"]
        normalized_top_label = normalize_label(raw_label)
        is_tumor = "no tumor" not in raw_label.lower().replace("_", " ")

        return {
            "available": True,
            "model_id": classifier_model_id,
            "guide_model_id": HF_MODEL_ID,
            "fallback_in_use": classifier_model_id != HF_MODEL_ID,
            "representative_slice": representative_index,
            "top_label": normalized_top_label,
            "confidence": round(float(top_prediction["score"]) * 100, 2),
            "is_tumor": is_tumor,
            "predictions": [
                {
                    "label": normalize_label(item["label"]),
                    "score": round(float(item["score"]) * 100, 2),
                }
                for item in results
            ],
        }
    except Exception as exc:
        print(f"Classification failed: {exc}")
        return {
            "available": False,
            "model_id": classifier_model_id,
            "error": str(exc),
        }


def generate_local_summary(metrics: dict[str, Any], classification: dict[str, Any] | None) -> str:
    tumor_percentage = metrics.get("tumor_percentage", 0)
    enhancing = metrics.get("enhancing_pixels", 0)
    edema = metrics.get("edema_pixels", 0)

    if classification and classification.get("available"):
        label_text = (
            f"The classifier's top label is {classification['top_label']} "
            f"at {classification['confidence']}% confidence."
        )
    else:
        label_text = "The classifier result is not available for this scan."

    if tumor_percentage < 1:
        burden_text = "Segmentation shows minimal visible tumor burden in the analyzed slices."
    elif tumor_percentage < 8:
        burden_text = (
            f"Segmentation shows a limited lesion burden covering about {tumor_percentage}% "
            "of analyzed pixels."
        )
    else:
        burden_text = (
            f"Segmentation shows a substantial lesion burden covering about {tumor_percentage}% "
            "of analyzed pixels."
        )

    region_text = (
        f"Edema pixels: {edema}; enhancing tumor pixels: {enhancing}. "
        "This output is for research use and should not be treated as a diagnosis."
    )
    return " ".join([burden_text, label_text, region_text])


def generate_groq_summary(
    metrics: dict[str, Any], classification: dict[str, Any] | None
) -> tuple[str, str]:
    local_summary = generate_local_summary(metrics, classification)
    if not groq_client:
        return local_summary, "local"

    classifier_text = "Unavailable"
    if classification and classification.get("available"):
        classifier_text = (
            f"{classification['top_label']} at {classification['confidence']}% confidence"
        )

    prompt = f"""
You are writing a short MRI analysis summary for a hackathon demo.
Keep it to 2 sentences in plain English.
State that it is a research-only output and not a diagnosis.

Segmentation metrics:
- Tumor coverage: {metrics.get("tumor_percentage", 0)}%
- Necrotic pixels: {metrics.get("necrotic_pixels", 0)}
- Edema pixels: {metrics.get("edema_pixels", 0)}
- Enhancing tumor pixels: {metrics.get("enhancing_pixels", 0)}

Classifier result:
- {classifier_text}
"""

    try:
        message = groq_client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=160,
            temperature=0.2,
        )
        return message.choices[0].message.content.strip(), "groq"
    except Exception as exc:
        print(f"Groq summary failed: {exc}")
        return local_summary, "local"


def preprocess_volume(file_path: str) -> tuple[np.ndarray | None, np.ndarray | None]:
    if not nib or not cv2:
        print("preprocess_volume skipped: nibabel/cv2 unavailable")
        return None, None
    try:
        flair = nib.load(file_path).get_fdata()
        slices = flair.shape[2]
        volume_batch = np.zeros((slices, IMG_SIZE, IMG_SIZE, 1), dtype=np.float32)

        for slice_index in range(slices):
            volume_batch[slice_index, :, :, 0] = cv2.resize(
                flair[:, :, slice_index], (IMG_SIZE, IMG_SIZE)
            )

        batch_max = float(np.max(volume_batch))
        if batch_max > 0:
            volume_batch = volume_batch / batch_max

        model_input = np.repeat(volume_batch, 2, axis=-1)
        return volume_batch, model_input
    except Exception as exc:
        print(f"Volume preprocessing failed: {exc}")
        return None, None


def get_segmentation_predictions(model_input: np.ndarray) -> np.ndarray | None:
    if segmentation_model is None:
        print("Segmentation model is unavailable")
        return None

    try:
        predictions = segmentation_model.predict(model_input, verbose=0)
        return np.argmax(predictions, axis=-1)
    except Exception as exc:
        print(f"Segmentation prediction failed: {exc}")
        return None


def extract_slices_nibabel(file_path: str, scan_id: str) -> list[dict]:
    """Extract real MRI slices into static/outputs/{scan_id}/ using nibabel + matplotlib."""
    if not nib or not plt:
        return []
    try:
        out_dir = os.path.join(OUTPUT_FOLDER, scan_id)
        os.makedirs(out_dir, exist_ok=True)
        vol = nib.load(file_path).get_fdata()
        num_slices = vol.shape[2]
        indices = list(range(0, num_slices, max(1, num_slices // 80)))[:80]
        paths = []
        for idx, i in enumerate(indices):
            sl = vol[:, :, i]
            vmin, vmax = float(np.min(sl)), float(np.max(sl))
            norm = (sl - vmin) / (vmax - vmin) if vmax > vmin else np.zeros_like(sl)
            flair_path = os.path.join(out_dir, f"flair_{idx:03d}.png")
            plt.imsave(flair_path, norm, cmap="gray")
            paths.append({
                "flair": f"/static/outputs/{scan_id}/flair_{idx:03d}.png",
                "overlay": f"/static/outputs/{scan_id}/flair_{idx:03d}.png",
                "slice_index": i,
            })
        print(f"Extracted {len(paths)} slices → static/outputs/{scan_id}/")
        return paths
    except Exception as exc:
        print(f"Slice extraction failed: {exc}")
        return []


def process_nii(file_path: str, scan_id: str = "tmp") -> dict[str, Any] | None:
    # Always extract real slices using nibabel (works without TF)
    slice_paths = extract_slices_nibabel(file_path, scan_id)

    # ML pipeline (segmentation + classification) requires TF/Keras
    if not tf or not keras:
        summary, summary_source = generate_groq_summary({}, None)
        return {
            "slices": slice_paths,
            "metrics": None,
            "classification": {"available": False, "error": "Segmentation model unavailable (TF/Keras not installed)."},
            "summary": summary,
            "summary_source": summary_source,
        }

    volume_batch, model_input = preprocess_volume(file_path)
    if volume_batch is None or model_input is None:
        return None

    predictions = get_segmentation_predictions(model_input)
    if predictions is None:
        return {"slices": slice_paths, "metrics": None, "classification": None, "summary": "Segmentation failed.", "summary_source": "local"}

    # Add overlay images on top of already-extracted slices
    overlay_paths = []
    for slice_num in range(predictions.shape[0]):
        flair_path = os.path.join(OUTPUT_FOLDER, f"flair_{slice_num}.png")
        mask_path = os.path.join(OUTPUT_FOLDER, f"mask_{slice_num}.png")
        overlay_path = os.path.join(OUTPUT_FOLDER, f"overlay_{slice_num}.png")

        plt.imsave(flair_path, volume_batch[slice_num, :, :, 0], cmap="gray")
        plt.imsave(mask_path, predictions[slice_num], cmap="turbo")

        fig, ax = plt.subplots()
        ax.imshow(volume_batch[slice_num, :, :, 0], cmap="gray")
        ax.imshow(predictions[slice_num], cmap="turbo", alpha=0.48)
        ax.axis("off")
        plt.savefig(overlay_path, bbox_inches="tight", pad_inches=0)
        plt.close(fig)

        overlay_paths.append({
            "flair": f"/static/outputs/flair_{slice_num}.png",
            "mask": f"/static/outputs/mask_{slice_num}.png",
            "overlay": f"/static/outputs/overlay_{slice_num}.png",
        })

    metrics = calculate_metrics(predictions)
    classification = build_classification_result(volume_batch, predictions)
    summary, summary_source = generate_groq_summary(metrics or {}, classification)

    return {
        "slices": overlay_paths,
        "metrics": metrics,
        "classification": classification,
        "summary": summary,
        "summary_source": summary_source,
    }


def extract_volume_metadata(file_path: str) -> dict[str, Any] | None:
    try:
        nii_image = nib.load(file_path)
        shape = list(nii_image.shape)
        zooms = [round(float(value), 2) for value in nii_image.header.get_zooms()[: len(shape)]]
        return {
            "shape": shape,
            "voxel_spacing": zooms,
            "dtype": str(nii_image.get_data_dtype()),
        }
    except Exception as exc:
        print(f"Metadata extraction failed: {exc}")
        return None


@app.post("/detect_tumor")
async def detect_tumor(
    file: UploadFile = File(...),
    patient_id: str = Form(None),
    user: dict = Depends(require_role("admin")),
):
    print(f"[detect_tumor] user={user}")
    if not file:
        return JSONResponse({"error": "No file uploaded"}, status_code=400)

    scan_id = str(uuid.uuid4())

    # Organise storage: uploads/{patient_id}/{scan_id}/  or  uploads/unassigned/{scan_id}/
    sub_dir = patient_id if patient_id else "unassigned"
    scan_dir = os.path.join(UPLOAD_FOLDER, sub_dir, scan_id)
    os.makedirs(scan_dir, exist_ok=True)

    filename = sanitize_upload_name(file.filename)
    file_path = os.path.join(scan_dir, filename)

    try:
        content = await file.read()
        with open(file_path, "wb") as buffer:
            buffer.write(content)

        result = process_nii(file_path, scan_id)
        if not result:
            return JSONResponse({"error": "Failed to process file"}, status_code=500)

        latest_analysis.clear()
        latest_analysis.update(result)

        # Persist to Supabase if a patient_id was provided
        if patient_id and supabase_admin:
            try:
                nii_url = "/" + file_path.replace("\\", "/")
                scan_resp = supabase_admin.table("scans").insert({
                    "id": scan_id,
                    "patient_id": patient_id,
                    "uploaded_by": user["id"],
                    "file_path": file_path,
                    "nii_url": nii_url,
                    "modality": "MRI",
                    "status": "complete",
                }).execute()

                metrics = result.get("metrics") or {}
                classification = result.get("classification") or {}
                structured_findings = {
                    "findings": f"Tumor coverage {metrics.get('tumor_percentage', 0)}%.",
                    "impression": result.get("summary", ""),
                    "recommendation": "Correlate with clinical presentation.",
                    "risk": "high" if (metrics.get("tumor_percentage") or 0) > 5 else "low",
                    "classes": classification.get("predictions", []),
                    "metrics": metrics,
                    "slice_count": len(result.get("slices", [])),
                    "slice_base": f"/static/outputs/{scan_id}/",
                }

                supabase_admin.table("analysis_results").insert({
                    "scan_id": scan_id,
                    "segmentation_metrics": metrics,
                    "classifier_label": classification.get("top_label"),
                    "confidence": classification.get("confidence"),
                    "ai_summary": result.get("summary"),
                    "structured_findings": structured_findings,
                    "model_version": f"seg:v1/{classification.get('model_id','?')}",
                }).execute()

                supabase_admin.table("patients").update({"risk": structured_findings["risk"]}).eq("id", patient_id).execute()
                supabase_admin.table("audit_logs").insert({
                    "user_id": user["id"],
                    "action": "scan.upload",
                    "resource": f"scan:{scan_id}",
                }).execute()
            except Exception as db_exc:
                print(f"DB persist failed (non-fatal): {db_exc}")

        return JSONResponse({**result, "scan_id": scan_id})
    except Exception as exc:
        print(f"detect_tumor failed: {exc}")
        return JSONResponse({"error": str(exc)}, status_code=500)


@app.post("/upload_nii")
async def upload_nii(file: UploadFile = File(...)):
    if not file:
        return JSONResponse({"error": "No file uploaded"}, status_code=400)

    filename = sanitize_upload_name(file.filename)
    file_path = os.path.join(UPLOAD_FOLDER, filename)

    try:
        content = await file.read()
        with open(file_path, "wb") as buffer:
            buffer.write(content)

        metadata = extract_volume_metadata(file_path)
        return JSONResponse(
            {
                "message": "File uploaded successfully",
                "file_path": f"/uploads/{filename}",
                "metadata": metadata,
            }
        )
    except Exception as exc:
        print(f"upload_nii failed: {exc}")
        return JSONResponse({"error": str(exc)}, status_code=500)


@app.get("/download_results")
async def download_results():
    try:
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
            for root, _, files in os.walk(OUTPUT_FOLDER):
                for file_name in files:
                    if not file_name.endswith(".png"):
                        continue
                    file_path = os.path.join(root, file_name)
                    arcname = os.path.relpath(file_path, OUTPUT_FOLDER)
                    zip_file.write(file_path, arcname)

        zip_buffer.seek(0)
        return StreamingResponse(
            zip_buffer,
            media_type="application/zip",
            headers={"Content-Disposition": "attachment; filename=tumor_analysis.zip"},
        )
    except Exception as exc:
        print(f"download_results failed: {exc}")
        return JSONResponse({"error": "Failed to download results"}, status_code=500)


@app.get("/get_summary")
async def get_summary():
    if not latest_analysis:
        return JSONResponse(
            {
                "summary": "No scan has been analyzed yet.",
                "summary_source": "none",
            }
        )

    return JSONResponse(
        {
            "summary": latest_analysis.get("summary"),
            "summary_source": latest_analysis.get("summary_source"),
            "classification": latest_analysis.get("classification"),
        }
    )


@app.get("/api/me")
async def get_me(user: dict = Depends(get_current_user)) -> dict:
    """Return the current user's profile (used by the SPA on load)."""
    return user


@app.get("/")
async def home(request: Request):
    """Serve the new React SPA."""
    return templates.TemplateResponse(request, "index.html", {
        "supabase_url": os.getenv("SUPABASE_URL", ""),
        "supabase_anon_key": os.getenv("SUPABASE_ANON_KEY", ""),
    })


@app.get("/legacy")
async def legacy_home(request: Request):
    """Keep the old UI accessible at /legacy."""
    return templates.TemplateResponse(request, "front.html", {})


@app.get("/advanced")
async def advanced(request: Request):
    return templates.TemplateResponse(request, "advanced.html", {})


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=SERVER_HOST, port=SERVER_PORT)
