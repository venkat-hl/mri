"""FastAPI auth dependencies."""

import json
import os
from typing import Any

import jwt
from jwt.algorithms import ECAlgorithm
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from db import supabase_admin

# Supabase ES256 public key — fetched once from:
# https://vocrclqaavorcvdekyqs.supabase.co/auth/v1/.well-known/jwks.json
_JWK = {
    "kty": "EC",
    "crv": "P-256",
    "x": "zrzAsmW8nsKCUQ9YwxTY1D2IeGNDdK6wltwYPLtg8Gs",
    "y": "NtX_jVBIerWyrksr0ltm77qXhRndJ24YQSpUk8R91Ec",
}
_PUBLIC_KEY = ECAlgorithm.from_jwk(json.dumps(_JWK))

_bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict[str, Any]:
    if not creds:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    try:
        payload = jwt.decode(
            creds.credentials,
            _PUBLIC_KEY,
            algorithms=["ES256"],
            options={"verify_aud": False},
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired")
    except jwt.PyJWTError as exc:
        print(f"[auth] JWT decode failed: {exc}")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc))

    user_id: str = payload.get("sub", "")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    if not supabase_admin:
        return {
            "id": user_id,
            "email": payload.get("email", ""),
            "role": payload.get("user_metadata", {}).get("role", "patient"),
        }

    resp = (
        supabase_admin.table("profiles")
        .select("id, full_name, role, avatar_color")
        .eq("id", user_id)
        .single()
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Profile not found")

    return resp.data


def require_role(*roles: str):
    async def _check(user: dict = Depends(get_current_user)) -> dict:
        if user.get("role") not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires role: {', '.join(roles)}",
            )
        return user
    return _check
