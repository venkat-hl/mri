# BrainTumor_BetaV1 — Copilot Implementation Guide

> **Stack:** Python · FastAPI · Keras/TensorFlow · Groq API · NiiVue · Vanilla JS  
> **No Supabase needed** — all file storage stays local (`uploads/`, `static/outputs/`)  
> **Base repo:** https://github.com/rajeev8008/BrainTumor_BetaV1

---

# IMPORTANT — HuggingFace Model Setup for Hackathon Demo

When you use `transformers.pipeline()` in Python, it downloads the model to your machine the first time (~200–500MB), then caches it locally.

After the first download:
- Every run is local and fast
- No internet is needed during the demo
- Much safer for a hackathon presentation

The HuggingFace Inference API runs the model on HuggingFace servers instead:
- No download required
- But the free tier is slow (20–30 seconds per request)
- Rate-limited
- Risky for live demos

## Recommendation

Use a local Transformers pipeline and cache the model now before coding.

Run this once in a terminal:

```bash
python -c "from transformers import pipeline; pipeline('image-classification', model='Ridwan/Brain-tumor-classification-MRI')"
```

That downloads and caches the model.

After that:
- inference becomes fast
- works offline
- no repeated downloads

Start this download immediately and let it run in the background while implementing the frontend changes.

---

# Revised Realistic Plan — TODAY ONLY

Given:
- no model changes
- free HuggingFace models only
- one day timeline
- hackathon demo priorities

This is the realistic implementation scope for today.

## Total realistic time
~6 hours for everything important.

## Recommended implementation order

### 1. Start the HF model download immediately
Run the caching command first and leave it running in the background.

---

### 2. Do frontend-only tasks first
These are low risk and give immediate visible improvements:
- detection badges
- segmentation metrics panel
- download ZIP button
- overlay toggles

These are safest because they don't change architecture.

---

### 3. Swap in NiiVue
This gives the biggest visual improvement for the demo:
- multiplanar MRI viewer
- modern interaction
- better presentation quality

High visual impact for judges.

---

### 4. Add Groq summary generation
Get a free API key from:

https://console.groq.com

This takes ~2 minutes.

Use Groq only for:
- plain-English MRI summaries
- clinical-style output
- visible AI functionality

---

### 5. Add HF classifier badge last
By this point the model should already be downloaded and cached locally.

Then integrate:
```python
pipeline(
    "image-classification",
    model="Ridwan/Brain-tumor-classification-MRI"
)
```

---

# IMPORTANT — Skip LangGraph Today

Do NOT build LangGraph today.

Reason:
- the jury will not see orchestration layers
- LangGraph adds complexity
- increases debugging risk
- not necessary for the demo

The Groq summary already provides the visible AI functionality judges care about.

Build LangGraph properly after the hackathon.

---

## Highest Priority Features for Demo

1. NiiVue viewer
2. Segmentation metrics
3. AI-generated Groq summary
4. Detection badge
5. Download ZIP

These provide the best:
- visual impact
- perceived complexity
- demo reliability
- implementation speed

---

# Simplified Hackathon Architecture

```text
Upload MRI
     ↓
U-Net Segmentation
     ↓
Generate Slice PNGs
     ↓
Compute Metrics
     ↓
HF Classification Badge
     ↓
Groq Summary
     ↓
Frontend Visualization
```

---

# Notes

- Keep everything local whenever possible
- Avoid external API dependencies during demos
- Optimize for reliability, not architecture purity
- Prioritize visible features over backend complexity
- Stable demos win hackathons

