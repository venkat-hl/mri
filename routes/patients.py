"""Patient + doctor CRUD routes."""
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user, require_role
from db import supabase_admin

router = APIRouter(prefix="/api", tags=["patients"])


# ------------------------------------------------------------------ patients
@router.get("/patients")
async def list_patients(user: dict = Depends(get_current_user)) -> list[dict]:
    if not supabase_admin:
        return []

    role = user["role"]
    q = supabase_admin.table("patients").select("*")

    if role == "doctor":
        q = q.eq("assigned_doctor_id", user["id"])
    elif role == "patient":
        q = q.eq("user_id", user["id"])
    # admin gets all

    resp = q.order("created_at", desc=True).execute()
    return resp.data or []


@router.get("/patients/{patient_id}")
async def get_patient(patient_id: str, user: dict = Depends(get_current_user)) -> dict:
    if not supabase_admin:
        raise HTTPException(404, "DB unavailable")

    resp = (
        supabase_admin.table("patients")
        .select("*")
        .eq("id", patient_id)
        .single()
        .execute()
    )
    if not resp.data:
        raise HTTPException(404, "Patient not found")

    p = resp.data
    _assert_access(user, p)
    return p


class PatientCreate(BaseModel):
    user_id: str | None = None
    full_name: str
    dob: str | None = None
    sex: str | None = None
    mrn: str | None = None
    condition: str | None = None
    risk: str = "low"
    assigned_doctor_id: str | None = None


@router.post("/patients", dependencies=[Depends(require_role("admin"))])
async def create_patient(body: PatientCreate) -> dict:
    if not supabase_admin:
        raise HTTPException(503, "DB unavailable")

    resp = supabase_admin.table("patients").insert(body.model_dump(exclude_none=True)).execute()
    return resp.data[0]


# ------------------------------------------------------------------ scans for a patient
@router.get("/patients/{patient_id}/scans")
async def list_patient_scans(
    patient_id: str, user: dict = Depends(get_current_user)
) -> list[dict]:
    if not supabase_admin:
        return []

    # verify access
    await get_patient(patient_id, user)

    resp = (
        supabase_admin.table("scans")
        .select("*, analysis_results(*)")
        .eq("patient_id", patient_id)
        .order("created_at", desc=True)
        .execute()
    )
    return resp.data or []


# ------------------------------------------------------------------ timeline (scans + docs)
@router.get("/patients/{patient_id}/timeline")
async def patient_timeline(
    patient_id: str, user: dict = Depends(get_current_user)
) -> list[dict]:
    if not supabase_admin:
        return []

    await get_patient(patient_id, user)

    scans_resp = (
        supabase_admin.table("scans")
        .select("id, created_at, modality, sequence, status, nii_url, file_path, analysis_results(classifier_label, confidence, segmentation_metrics, structured_findings)")
        .eq("patient_id", patient_id)
        .order("created_at", desc=True)
        .execute()
    )

    docs_resp = (
        supabase_admin.table("documents")
        .select("id, created_at, original_name, source_type, ai_summary, structured_fields")
        .eq("patient_id", patient_id)
        .order("created_at", desc=True)
        .execute()
    )

    scan_ids = [s["id"] for s in scans_resp.data or []]
    if scan_ids:
        reports_resp = (
            supabase_admin.table("reports")
            .select("id, created_at, decision, status, doctor_id, scan_id")
            .in_("scan_id", scan_ids)
            .order("created_at", desc=True)
            .execute()
        )
    else:
        reports_resp = type("R", (), {"data": []})()

    items: list[dict[str, Any]] = []
    for s in scans_resp.data or []:
        items.append({"type": "scan", "date": s["created_at"], **s})
    for d in docs_resp.data or []:
        items.append({"type": "doc", "date": d["created_at"], **d})
    for r in reports_resp.data or []:
        items.append({"type": "report", "date": r["created_at"], **r})

    items.sort(key=lambda x: x["date"], reverse=True)
    return items


# ------------------------------------------------------------------ helpers
def _assert_access(user: dict, patient: dict) -> None:
    role = user["role"]
    uid = user["id"]
    if role == "admin":
        return
    if role == "doctor" and patient.get("assigned_doctor_id") == uid:
        return
    if role == "patient" and patient.get("user_id") == uid:
        return
    raise HTTPException(403, "Access denied")
