"""Scan detail + annotation endpoints."""
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user, require_role
from db import supabase_admin

router = APIRouter(prefix="/api/scans", tags=["scans"])


@router.get("/{scan_id}")
async def get_scan(scan_id: str, user: dict = Depends(get_current_user)) -> dict:
    if not supabase_admin:
        raise HTTPException(503, "DB unavailable")

    resp = (
        supabase_admin.table("scans")
        .select("*, analysis_results(*), patients(user_id, assigned_doctor_id)")
        .eq("id", scan_id)
        .single()
        .execute()
    )
    if not resp.data:
        raise HTTPException(404, "Scan not found")

    scan = resp.data
    _assert_scan_access(user, scan)
    return scan


# ------------------------------------------------------------------ annotations
class AnnotationCreate(BaseModel):
    slice_index: int | None = None
    shape_type: str
    coordinates: dict | None = None
    note: str | None = None
    decision: str | None = None


@router.post("/{scan_id}/annotations", dependencies=[Depends(require_role("doctor", "admin"))])
async def save_annotation(
    scan_id: str,
    body: AnnotationCreate,
    user: dict = Depends(require_role("doctor", "admin")),
) -> dict:
    if not supabase_admin:
        raise HTTPException(503, "DB unavailable")

    row = {
        "scan_id": scan_id,
        "doctor_id": user["id"],
        **body.model_dump(exclude_none=True),
    }
    resp = supabase_admin.table("annotations").insert(row).execute()
    _log(user["id"], "annotation.create", f"scan:{scan_id}")
    return resp.data[0]


@router.get("/{scan_id}/annotations")
async def list_annotations(
    scan_id: str, user: dict = Depends(get_current_user)
) -> list[dict]:
    if not supabase_admin:
        return []

    # verify read access via scan
    await get_scan(scan_id, user)

    resp = (
        supabase_admin.table("annotations")
        .select("*")
        .eq("scan_id", scan_id)
        .order("created_at")
        .execute()
    )
    return resp.data or []


# ------------------------------------------------------------------ reports (sign-off)
class ReportCreate(BaseModel):
    decision: str   # agree | edit | reject
    notes: str | None = None
    status: str = "draft"   # draft | final


@router.post("/{scan_id}/report", dependencies=[Depends(require_role("doctor"))])
async def upsert_report(
    scan_id: str,
    body: ReportCreate,
    user: dict = Depends(require_role("doctor")),
) -> dict:
    if not supabase_admin:
        raise HTTPException(503, "DB unavailable")

    existing = (
        supabase_admin.table("reports")
        .select("id")
        .eq("scan_id", scan_id)
        .eq("doctor_id", user["id"])
        .execute()
    )

    row = {
        "scan_id": scan_id,
        "doctor_id": user["id"],
        "decision": body.decision,
        "notes": body.notes,
        "status": body.status,
    }

    if existing.data:
        resp = (
            supabase_admin.table("reports")
            .update({**row, "updated_at": "now()"})
            .eq("id", existing.data[0]["id"])
            .execute()
        )
    else:
        resp = supabase_admin.table("reports").insert(row).execute()

    _log(user["id"], f"report.{body.status}", f"scan:{scan_id}")
    return resp.data[0]


@router.get("/{scan_id}/report")
async def get_report(scan_id: str, user: dict = Depends(get_current_user)) -> dict | None:
    if not supabase_admin:
        return None

    q = supabase_admin.table("reports").select("*").eq("scan_id", scan_id)
    if user["role"] == "patient":
        q = q.eq("status", "final")
    resp = q.order("updated_at", desc=True).limit(1).execute()
    return resp.data[0] if resp.data else None


# ------------------------------------------------------------------ helpers
def _assert_scan_access(user: dict, scan: dict) -> None:
    role = user["role"]
    uid = user["id"]
    p = scan.get("patients") or {}
    if role == "admin":
        return
    if role == "doctor" and p.get("assigned_doctor_id") == uid:
        return
    if role == "patient" and p.get("user_id") == uid:
        return
    raise HTTPException(403, "Access denied")


def _log(user_id: str, action: str, resource: str) -> None:
    if not supabase_admin:
        return
    try:
        supabase_admin.table("audit_logs").insert(
            {"user_id": user_id, "action": action, "resource": resource}
        ).execute()
    except Exception:
        pass
