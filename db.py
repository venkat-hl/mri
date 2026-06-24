"""Supabase client singleton — import `supabase_client` for anon access,
`supabase_admin` for service-role (bypasses RLS)."""

import os
from supabase import create_client, Client

_url: str = os.getenv("SUPABASE_URL", "")
_anon: str = os.getenv("SUPABASE_ANON_KEY", "")
_service: str = os.getenv("SUPABASE_SERVICE_KEY", "")

supabase_client: Client = create_client(_url, _anon) if _url and _anon else None  # type: ignore
supabase_admin: Client = create_client(_url, _service) if _url and _service else None  # type: ignore
