"""Document digitization pipeline.

- Native-text PDF  → pdfplumber extract → Groq text summary
- Scanned image/photo → Claude claude-haiku-4-5-20251001 vision → structured JSON
"""
import json
import os
import uuid
from pathlib import Path

import pdfplumber
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from auth import get_current_user, require_role
from db import supabase_admin

router = APIRouter(prefix="/api/documents", tags=["documents"])

UPLOAD_FOLDER = Path("uploads")
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")

_groq = None


def _get_groq():
    global _groq
    if _groq is None:
        try:
            from groq import Groq
            if GROQ_API_KEY:
                _groq = Groq(api_key=GROQ_API_KEY)
        except ImportError:
            pass
    return _groq


ALLOWED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".tiff", ".tif", ".webp"}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".tiff", ".tif", ".webp"}


@router.post("/upload", dependencies=[Depends(require_role("admin"))])
async def upload_document(
    file: UploadFile = File(...),
    patient_id: str = Form(...),
    user: dict = Depends(require_role("admin")),
) -> JSONResponse:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"Unsupported file type: {suffix}")

    # Save file
    doc_id = str(uuid.uuid4())
    dest_dir = UPLOAD_FOLDER / "documents" / patient_id
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / f"{doc_id}{suffix}"

    content = await file.read()
    dest_path.write_bytes(content)
    rel_path = str(dest_path)

    # Determine source type and extract
    if suffix == ".pdf":
        source_type, extracted_text, structured = _process_pdf(dest_path)
    else:
        source_type = "scanned_image"
        extracted_text, structured = _process_image(content, suffix, file.filename or "")

    # AI summary of extracted text (Groq, text only)
    ai_summary = _groq_summarize(extracted_text or json.dumps(structured))

    # Persist
    row = {
        "id": doc_id,
        "patient_id": patient_id,
        "uploaded_by": user["id"],
        "file_path": rel_path,
        "original_name": file.filename,
        "source_type": source_type,
        "extracted_text": extracted_text,
        "structured_fields": structured,
        "ai_summary": ai_summary,
    }

    if supabase_admin:
        supabase_admin.table("documents").insert(row).execute()
        supabase_admin.table("audit_logs").insert({
            "user_id": user["id"],
            "action": "document.upload",
            "resource": f"document:{doc_id}",
        }).execute()

    return JSONResponse(row)


@router.get("")
async def list_documents(
    patient_id: str,
    user: dict = Depends(get_current_user),
) -> list[dict]:
    if not supabase_admin:
        return []

    q = (
        supabase_admin.table("documents")
        .select("id, patient_id, original_name, source_type, ai_summary, structured_fields, created_at")
        .eq("patient_id", patient_id)
        .order("created_at", desc=True)
    )
    resp = q.execute()
    return resp.data or []


@router.get("/{doc_id}")
async def get_document(doc_id: str, user: dict = Depends(get_current_user)) -> dict:
    if not supabase_admin:
        raise HTTPException(503, "DB unavailable")
    resp = (
        supabase_admin.table("documents")
        .select("*")
        .eq("id", doc_id)
        .single()
        .execute()
    )
    if not resp.data:
        raise HTTPException(404, "Document not found")
    return resp.data


# ------------------------------------------------------------------ processors

def _process_pdf(path: Path) -> tuple[str, str, dict]:
    """Return (source_type, extracted_text, structured_fields)."""
    try:
        with pdfplumber.open(path) as pdf:
            pages_text = [p.extract_text() or "" for p in pdf.pages]
        text = "\n\n".join(pages_text).strip()
    except Exception as exc:
        return "native_pdf", "", {"error": str(exc)}

    if not text:
        # No text layer — treat as scanned image (convert first page to image via pdfplumber)
        return "scanned_image", "", {}

    structured = _groq_structure(text)
    return "native_pdf", text, structured


def _process_image(content: bytes, suffix: str, filename: str) -> tuple[str, dict]:
    """Scanned image OCR — vision model not configured, return placeholder."""
    return "", {
        "document_type": "Scanned image",
        "note": "Vision OCR not configured. Add ANTHROPIC_API_KEY to .env to enable scanned image extraction.",
        "filename": filename,
    }


def _groq_structure(text: str) -> dict:
    """Ask Groq to extract structured fields from native-text PDF."""
    client = _get_groq()
    if not client:
        return {}

    prompt = f"""Extract structured fields from this medical document text.
Return ONLY valid JSON with these fields (null if not found):
{{
  "document_type": "string",
  "date": "ISO date or null",
  "doctor_name": "string or null",
  "patient_name": "string or null",
  "diagnosis": "string or null",
  "medications": ["list"] or []
}}

Document text:
{text[:3000]}"""

    try:
        resp = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=400,
            temperature=0.1,
        )
        raw = resp.choices[0].message.content.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1].lstrip("json").strip()
        return json.loads(raw)
    except Exception:
        return {}


def _groq_summarize(text: str) -> str:
    """One-paragraph plain-English summary of the document."""
    client = _get_groq()
    if not client:
        return text[:500]

    prompt = f"""Write a 2-sentence plain-English summary of this medical document.
State the document type, the key clinical facts, and any action required.

Document:
{text[:2000]}"""

    try:
        resp = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=200,
            temperature=0.2,
        )
        return resp.choices[0].message.content.strip()
    except Exception:
        return text[:300]
