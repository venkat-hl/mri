# BrainTumor AI

Clinical MRI intelligence platform — AI-assisted tumor segmentation, 3D visualization, and a shared record connecting imaging teams, clinicians, and patients.

## Features

- **3-role portal** — Admin, Clinician, Patient with isolated views and permissions
- **MRI upload & AI analysis** — Upload NIfTI (`.nii` / `.nii.gz`) scans; segmentation model locates the tumor, HuggingFace classifier identifies the type
- **2D slice viewer** — Navigate real extracted MRI slices with overlay toggle
- **3D volume viewer** — WebGL NIfTI rendering via NiiVue (rotate, zoom, multiplanar)
- **Clinical timeline** — Per-patient history of scans, documents, and reports
- **Document OCR** — Upload PDFs/images; text is extracted automatically
- **Doctor sign-off** — Clinician reviews AI findings and finalizes a report
- **Supabase auth** — ES256 JWT, role-locked portals

---

## Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11, FastAPI, Uvicorn |
| Frontend | React 18 (no build step, Babel via CDN) |
| Database / Auth | Supabase (PostgreSQL + Auth) |
| ML — Segmentation | TensorFlow / Keras (`.h5` model) |
| ML — Classification | HuggingFace Transformers (`image-classification` pipeline) |
| 3D Viewer | NiiVue 0.69.0 (WebGL, bundled locally) |
| MRI Processing | nibabel, matplotlib, OpenCV |

---

## Prerequisites

- Python 3.11
- A [Supabase](https://supabase.com) project with Email auth enabled
- (Optional) Groq API key for LLM chat features
- (Optional) HuggingFace token for private classifier models

---

## Quick start

### 1. Clone

```bash
git clone https://github.com/sreekarnaruto/BrainTumor-AI.git
cd BrainTumor-AI
```

### 2. Create virtual environment

```bash
python3.11 -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

> **Apple Silicon (M1/M2/M3):** Install `tensorflow-macos==2.15.0` and `tensorflow-metal==1.1.0` instead of `tensorflow`, and pin `numpy<2.0.0`.

### 3. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in your Supabase credentials:

```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-role-key
```

### 4. Set up Supabase

1. **Enable Email provider** → Authentication → Providers → Email → Enable
2. Run `supabase/schema.sql` in the Supabase SQL editor to create all tables
3. Create users via Authentication → Users and set `role` in user metadata (`admin`, `doctor`, or `patient`)

### 5. Add the segmentation model

Place your trained Keras model at:

```
model/model_x1_1.h5
```

### 6. Run

```bash
venv/bin/uvicorn app:app --port 5000
```

Open [http://localhost:5000](http://localhost:5000)

---

## Project structure

```
├── app.py                   # FastAPI app, ML pipeline, NIfTI processing
├── auth.py                  # JWT verification (Supabase ES256)
├── db.py                    # Supabase admin client
├── routes/
│   ├── patients.py          # Patient CRUD, timeline, scans
│   ├── scans.py             # Scan detail, reports, annotations
│   ├── documents.py         # PDF/image upload + OCR
│   └── chat.py              # LLM Q&A endpoint
├── static/
│   ├── css/design.css       # Design system
│   └── js/
│       ├── app.js           # Root — portal landing + auth
│       ├── admin.js         # Admin portal
│       ├── doctor.js        # Clinician portal
│       ├── patient.js       # Patient portal
│       ├── api.js           # API client
│       ├── real_viewer.js   # 2D MRI slice viewer
│       ├── niivue_viewer.js # 3D WebGL NIfTI viewer
│       └── ui.js            # Shared UI components
├── templates/index.html     # Single HTML shell
├── supabase/schema.sql      # Database schema
├── model/                   # Keras model (not committed)
├── uploads/                 # Uploaded files (not committed)
└── static/outputs/          # Extracted MRI slices (not committed)
```

---

## User roles

| Role | Access |
|---|---|
| **Admin** | Upload NIfTI scans & documents, create patients, assign to doctors |
| **Doctor** | View assigned patients, scan viewer, AI analysis, finalize reports |
| **Patient** | View own scan history, reports, clinical timeline |

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `SUPABASE_URL` | Yes | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | Supabase anonymous (public) key |
| `SUPABASE_SERVICE_KEY` | Yes | Supabase service role key (server-side only) |
| `GROQ_API_KEY` | No | Groq LLM key for document chat |
| `GROQ_MODEL` | No | Model ID (default: `llama-3.1-8b-instant`) |
| `HF_TOKEN` | No | HuggingFace token for private models |
| `HF_MODEL_ID` | No | HuggingFace classifier model ID |

---

> This is a research and demonstration project, not a certified medical device. Do not use outputs as a clinical diagnosis.
