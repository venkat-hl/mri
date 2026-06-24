-- ============================================================
-- BrainTumor AI — Supabase schema + RLS
-- Run this in the Supabase SQL editor after creating your project.
-- ============================================================

-- Enable UUID extension (already on by default in Supabase)
create extension if not exists "uuid-ossp";

-- ============================================================
-- PROFILES — one row per auth.users entry, holds role
-- ============================================================
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  role        text not null check (role in ('admin', 'doctor', 'patient')),
  avatar_color text default 'oklch(0.55 0.115 248)',
  created_at  timestamptz default now()
);

-- ============================================================
-- PATIENTS — medical record per patient user
-- ============================================================
create table if not exists public.patients (
  id                  uuid primary key default uuid_generate_v4(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  full_name           text not null,
  dob                 date,
  sex                 text check (sex in ('M','F','O')),
  mrn                 text unique,
  condition           text,
  risk                text default 'low' check (risk in ('low','medium','high')),
  assigned_doctor_id  uuid references auth.users(id),
  created_at          timestamptz default now()
);

-- ============================================================
-- DOCTORS — extra attributes for doctor users
-- ============================================================
create table if not exists public.doctors (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  specialization  text,
  created_at      timestamptz default now()
);

-- ============================================================
-- SCANS — one row per NIfTI upload
-- ============================================================
create table if not exists public.scans (
  id           uuid primary key default uuid_generate_v4(),
  patient_id   uuid not null references public.patients(id) on delete cascade,
  uploaded_by  uuid not null references auth.users(id),
  file_path    text not null,   -- relative path under uploads/
  modality     text default 'MRI',
  sequence     text,
  status       text default 'pending' check (status in ('pending','processing','complete','failed')),
  created_at   timestamptz default now()
);

-- ============================================================
-- ANALYSIS_RESULTS — AI output for a scan
-- ============================================================
create table if not exists public.analysis_results (
  id                    uuid primary key default uuid_generate_v4(),
  scan_id               uuid not null references public.scans(id) on delete cascade,
  segmentation_metrics  jsonb,
  classifier_label      text,
  confidence            numeric(5,2),
  ai_summary            text,
  structured_findings   jsonb,   -- {findings, impression, recommendation, flag, risk, classes, metrics}
  model_version         text default 'v1.0',
  created_at            timestamptz default now()
);

-- ============================================================
-- ANNOTATIONS — doctor drawings/notes per scan slice
-- ============================================================
create table if not exists public.annotations (
  id           uuid primary key default uuid_generate_v4(),
  scan_id      uuid not null references public.scans(id) on delete cascade,
  doctor_id    uuid not null references auth.users(id),
  slice_index  integer,
  shape_type   text check (shape_type in ('pen','rect','arrow','ruler','text','signoff')),
  coordinates  jsonb,
  note         text,
  decision     text check (decision in ('agree','edit','reject')),
  created_at   timestamptz default now()
);

-- ============================================================
-- DOCUMENTS — uploaded PDFs / images with OCR results
-- ============================================================
create table if not exists public.documents (
  id               uuid primary key default uuid_generate_v4(),
  patient_id       uuid not null references public.patients(id) on delete cascade,
  uploaded_by      uuid not null references auth.users(id),
  file_path        text not null,
  original_name    text,
  source_type      text not null check (source_type in ('native_pdf','scanned_image')),
  extracted_text   text,
  structured_fields jsonb,  -- {document_type, date, doctor_name, diagnosis, medications, free_text}
  ai_summary       text,
  created_at       timestamptz default now()
);

-- ============================================================
-- REPORTS — finalized doctor sign-off reports
-- ============================================================
create table if not exists public.reports (
  id           uuid primary key default uuid_generate_v4(),
  scan_id      uuid not null references public.scans(id) on delete cascade,
  doctor_id    uuid not null references auth.users(id),
  decision     text check (decision in ('agree','edit','reject')),
  notes        text,
  status       text default 'draft' check (status in ('draft','final')),
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- ============================================================
-- AUDIT_LOGS — immutable event trail
-- ============================================================
create table if not exists public.audit_logs (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid references auth.users(id),
  action     text not null,   -- e.g. 'scan.upload', 'report.finalize'
  resource   text,            -- e.g. 'scan:uuid'
  metadata   jsonb,
  created_at timestamptz default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.profiles         enable row level security;
alter table public.patients         enable row level security;
alter table public.doctors          enable row level security;
alter table public.scans            enable row level security;
alter table public.analysis_results enable row level security;
alter table public.annotations      enable row level security;
alter table public.documents        enable row level security;
alter table public.reports          enable row level security;
alter table public.audit_logs       enable row level security;

-- Helper: is the calling user an admin?
create or replace function public.is_admin()
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- Helper: is the calling user a doctor?
create or replace function public.is_doctor()
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'doctor'
  );
$$;

-- ---- profiles ----
create policy "Own profile readable" on public.profiles
  for select using (id = auth.uid() or public.is_admin());

create policy "Admin can update any profile" on public.profiles
  for update using (public.is_admin());

create policy "Own profile insert on signup" on public.profiles
  for insert with check (id = auth.uid());

-- ---- patients ----
create policy "Admin sees all patients" on public.patients
  for all using (public.is_admin());

create policy "Doctor sees assigned patients" on public.patients
  for select using (
    public.is_doctor() and assigned_doctor_id = auth.uid()
  );

create policy "Patient sees own record" on public.patients
  for select using (user_id = auth.uid());

-- ---- doctors ----
create policy "Doctors and admins can read" on public.doctors
  for select using (public.is_admin() or public.is_doctor());

create policy "Admin full access" on public.doctors
  for all using (public.is_admin());

-- ---- scans ----
create policy "Admin full access scans" on public.scans
  for all using (public.is_admin());

create policy "Doctor sees scans of assigned patients" on public.scans
  for select using (
    public.is_doctor() and exists (
      select 1 from public.patients p
      where p.id = patient_id and p.assigned_doctor_id = auth.uid()
    )
  );

create policy "Patient sees own scans" on public.scans
  for select using (
    exists (
      select 1 from public.patients p
      where p.id = patient_id and p.user_id = auth.uid()
    )
  );

-- ---- analysis_results ----
create policy "Admin full access analysis" on public.analysis_results
  for all using (public.is_admin());

create policy "Doctor reads analysis of assigned scans" on public.analysis_results
  for select using (
    public.is_doctor() and exists (
      select 1 from public.scans s
      join public.patients p on p.id = s.patient_id
      where s.id = scan_id and p.assigned_doctor_id = auth.uid()
    )
  );

create policy "Patient reads own analysis" on public.analysis_results
  for select using (
    exists (
      select 1 from public.scans s
      join public.patients p on p.id = s.patient_id
      where s.id = scan_id and p.user_id = auth.uid()
    )
  );

-- ---- annotations ----
create policy "Doctor full access own annotations" on public.annotations
  for all using (doctor_id = auth.uid() or public.is_admin());

create policy "Doctor reads annotations on assigned scans" on public.annotations
  for select using (
    public.is_doctor() and exists (
      select 1 from public.scans s
      join public.patients p on p.id = s.patient_id
      where s.id = scan_id and p.assigned_doctor_id = auth.uid()
    )
  );

create policy "Patient reads annotations on own scans" on public.annotations
  for select using (
    exists (
      select 1 from public.scans s
      join public.patients p on p.id = s.patient_id
      where s.id = scan_id and p.user_id = auth.uid()
    )
  );

-- ---- documents ----
create policy "Admin full access documents" on public.documents
  for all using (public.is_admin());

create policy "Doctor reads documents of assigned patients" on public.documents
  for select using (
    public.is_doctor() and exists (
      select 1 from public.patients p
      where p.id = patient_id and p.assigned_doctor_id = auth.uid()
    )
  );

create policy "Patient reads own documents" on public.documents
  for select using (
    exists (
      select 1 from public.patients p
      where p.id = patient_id and p.user_id = auth.uid()
    )
  );

-- ---- reports ----
create policy "Doctor full access own reports" on public.reports
  for all using (doctor_id = auth.uid() or public.is_admin());

create policy "Doctor reads all reports on assigned scans" on public.reports
  for select using (
    public.is_doctor() and exists (
      select 1 from public.scans s
      join public.patients p on p.id = s.patient_id
      where s.id = scan_id and p.assigned_doctor_id = auth.uid()
    )
  );

create policy "Patient reads finalized reports on own scans" on public.reports
  for select using (
    status = 'final' and exists (
      select 1 from public.scans s
      join public.patients p on p.id = s.patient_id
      where s.id = scan_id and p.user_id = auth.uid()
    )
  );

-- ---- audit_logs ----
create policy "Admin reads all audit logs" on public.audit_logs
  for select using (public.is_admin());

create policy "Insert own audit log" on public.audit_logs
  for insert with check (user_id = auth.uid());

-- ============================================================
-- AUTO-CREATE PROFILE ON SIGNUP (trigger)
-- ============================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce(new.raw_user_meta_data->>'role', 'patient')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
