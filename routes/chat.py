"""Patient chatbot — scoped to the requesting patient's own records."""
import json
import os

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from auth import get_current_user
from db import supabase_admin

router = APIRouter(prefix="/api/chat", tags=["chat"])

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


class ChatRequest(BaseModel):
    question: str
    patient_id: str | None = None   # admins/doctors can specify; patients use their own


@router.post("")
async def chat(body: ChatRequest, user: dict = Depends(get_current_user)) -> JSONResponse:
    # Determine which patient to scope to
    patient_id = body.patient_id

    if user["role"] == "patient":
        # Always use own records regardless of what's passed
        resp = (
            supabase_admin.table("patients")
            .select("id")
            .eq("user_id", user["id"])
            .single()
            .execute()
            if supabase_admin else None
        )
        if not resp or not resp.data:
            raise HTTPException(404, "Patient record not found for this user")
        patient_id = resp.data["id"]

    if not patient_id:
        raise HTTPException(400, "patient_id required")

    # Gather context
    context = _build_context(patient_id)

    groq = _get_groq()
    if not groq:
        return JSONResponse({"answer": "Chat service unavailable — GROQ_API_KEY not configured.", "sources": []})

    system = f"""You are a medical records assistant for a clinical MRI platform.
You ONLY have access to the following patient records. Answer the patient's question
using ONLY the information provided. If the answer is not in the records, say so clearly
and suggest the patient speak to their doctor.

PATIENT RECORDS:
{context}

Rules:
- Speak in plain English, no jargon.
- Never make up diagnoses or medications not in the records.
- Always remind the patient that your answers are informational and to confirm with their doctor.
- If you cite information, note which document it came from."""

    try:
        completion = groq.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": body.question},
            ],
            max_tokens=400,
            temperature=0.3,
        )
        answer = completion.choices[0].message.content.strip()
        return JSONResponse({"answer": answer, "sources": _extract_sources(context)})
    except Exception as exc:
        return JSONResponse({"answer": f"Error: {exc}", "sources": []})


def _build_context(patient_id: str) -> str:
    if not supabase_admin:
        return "No database connection."

    parts: list[str] = []

    # Patient demographics
    p_resp = supabase_admin.table("patients").select("*").eq("id", patient_id).single().execute()
    if p_resp.data:
        p = p_resp.data
        parts.append(
            f"PATIENT: {p.get('full_name','?')}, DOB {p.get('dob','?')}, "
            f"MRN {p.get('mrn','?')}, condition: {p.get('condition','?')}"
        )

    # Latest scan analysis
    s_resp = (
        supabase_admin.table("scans")
        .select("created_at, modality, analysis_results(classifier_label, confidence, ai_summary, structured_findings)")
        .eq("patient_id", patient_id)
        .order("created_at", desc=True)
        .limit(3)
        .execute()
    )
    for s in s_resp.data or []:
        ar = (s.get("analysis_results") or [{}])
        ar = ar[0] if isinstance(ar, list) else ar
        findings = ar.get("structured_findings") or {}
        parts.append(
            f"\nSCAN ({s['created_at'][:10]}, {s.get('modality','MRI')}):\n"
            f"  AI label: {ar.get('classifier_label','?')} ({ar.get('confidence','?')}% confidence)\n"
            f"  Summary: {ar.get('ai_summary','')}\n"
            f"  Impression: {findings.get('impression','')}\n"
            f"  Recommendation: {findings.get('recommendation','')}"
        )

    # Finalized reports
    r_resp = (
        supabase_admin.table("reports")
        .select("created_at, decision, notes, scan_id")
        .eq("status", "final")
        .order("created_at", desc=True)
        .limit(3)
        .execute()
    )
    for r in r_resp.data or []:
        parts.append(
            f"\nDOCTOR REPORT ({r['created_at'][:10]}): decision={r.get('decision','?')}\n"
            f"  Notes: {r.get('notes','')}"
        )

    # Digitized documents
    d_resp = (
        supabase_admin.table("documents")
        .select("created_at, original_name, source_type, ai_summary, structured_fields")
        .eq("patient_id", patient_id)
        .order("created_at", desc=True)
        .limit(5)
        .execute()
    )
    for d in d_resp.data or []:
        sf = d.get("structured_fields") or {}
        parts.append(
            f"\nDOCUMENT: {d.get('original_name','?')} ({d['created_at'][:10]})\n"
            f"  Type: {sf.get('document_type','?')}\n"
            f"  Doctor: {sf.get('doctor_name','?')}\n"
            f"  Diagnosis: {sf.get('diagnosis','?')}\n"
            f"  Medications: {', '.join(sf.get('medications',[]))}\n"
            f"  Summary: {d.get('ai_summary','')}"
        )

    return "\n".join(parts) if parts else "No records found."


def _extract_sources(context: str) -> list[str]:
    sources = []
    for line in context.split("\n"):
        if line.startswith("SCAN") or line.startswith("DOCUMENT") or line.startswith("DOCTOR REPORT"):
            sources.append(line.strip().rstrip(":"))
    return sources[:5]
