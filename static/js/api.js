/* ============================================================
   BrainTumor AI — real API layer
   Replaces window.DB mock data. All calls go to the FastAPI backend.
   Auth token stored in sessionStorage after Supabase login.
   ============================================================ */
(function () {
  // ---- auth token ----
  const TOKEN_KEY = "bt_token";
  const ROLE_KEY  = "bt_role";

  function getToken() { return sessionStorage.getItem(TOKEN_KEY) || ""; }
  function setToken(t) { sessionStorage.setItem(TOKEN_KEY, t); }
  function clearToken() { sessionStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(ROLE_KEY); }

  async function apiFetch(path, opts = {}) {
    const token = getToken();
    const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
    if (token) headers["Authorization"] = "Bearer " + token;
    const res = await fetch(path, { ...opts, headers });
    if (res.status === 401) { clearToken(); window.location.reload(); return null; }
    if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.detail || res.statusText); }
    return res.json();
  }

  // ---- Supabase Auth (client-side sign-in) ----
  // We use the Supabase REST auth endpoint directly so no extra SDK is needed.
  const SUPABASE_URL  = window.SUPABASE_URL  || "";
  const SUPABASE_ANON = window.SUPABASE_ANON || "";

  async function signIn(email, password) {
    if (!SUPABASE_URL) throw new Error("SUPABASE_URL not configured");
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "apikey": SUPABASE_ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error_description || e.message || "Sign-in failed"); }
    const data = await res.json();
    setToken(data.access_token);
    // role comes back from our /api/me endpoint
    const profile = await apiFetch("/api/me");
    if (profile) {
      sessionStorage.setItem(ROLE_KEY, profile.role);
      return profile;
    }
    return null;
  }

  async function signOut() {
    if (SUPABASE_URL && getToken()) {
      await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: "POST",
        headers: { "apikey": SUPABASE_ANON, "Authorization": "Bearer " + getToken() },
      }).catch(() => {});
    }
    clearToken();
    localStorage.removeItem("bt_role");
  }

  // ---- patients ----
  async function listPatients() { return apiFetch("/api/patients") || []; }
  async function getPatient(id) { return apiFetch(`/api/patients/${id}`); }
  async function getTimeline(patientId) { return apiFetch(`/api/patients/${patientId}/timeline`) || []; }
  async function listPatientScans(patientId) { return apiFetch(`/api/patients/${patientId}/scans`) || []; }
  async function createPatient(data) {
    return apiFetch("/api/patients", { method: "POST", body: JSON.stringify(data) });
  }

  // ---- scans ----
  async function getScan(scanId) { return apiFetch(`/api/scans/${scanId}`); }
  async function getReport(scanId) { return apiFetch(`/api/scans/${scanId}/report`); }
  async function listAnnotations(scanId) { return apiFetch(`/api/scans/${scanId}/annotations`) || []; }

  async function saveAnnotation(scanId, annotation) {
    return apiFetch(`/api/scans/${scanId}/annotations`, {
      method: "POST", body: JSON.stringify(annotation),
    });
  }

  async function finalizeReport(scanId, decision, notes, status = "final") {
    return apiFetch(`/api/scans/${scanId}/report`, {
      method: "POST", body: JSON.stringify({ decision, notes, status }),
    });
  }

  // ---- detect tumor (admin upload with patient_id) ----
  async function detectTumor(file, patientId) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("patient_id", patientId);
    const token = getToken();
    const headers = {};
    if (token) headers["Authorization"] = "Bearer " + token;
    const res = await fetch("/detect_tumor", { method: "POST", headers, body: fd });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    return res.json();
  }

  // ---- documents ----
  async function listDocuments(patientId) {
    return apiFetch(`/api/documents?patient_id=${patientId}`) || [];
  }

  async function getDocument(docId) { return apiFetch(`/api/documents/${docId}`); }

  async function uploadDocument(file, patientId) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("patient_id", patientId);
    const token = getToken();
    const headers = {};
    if (token) headers["Authorization"] = "Bearer " + token;
    const res = await fetch("/api/documents/upload", { method: "POST", headers, body: fd });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || res.statusText);
    return res.json();
  }

  // ---- chat ----
  async function sendChatMessage(question, patientId) {
    return apiFetch("/api/chat", {
      method: "POST",
      body: JSON.stringify({ question, patient_id: patientId }),
    });
  }

  // ---- session helpers ----
  function getSavedRole() {
    return sessionStorage.getItem(ROLE_KEY) || localStorage.getItem("bt_role") || null;
  }
  function setSavedRole(r) {
    sessionStorage.setItem(ROLE_KEY, r);
    localStorage.setItem("bt_role", r);
  }

  window.API = {
    signIn, signOut,
    listPatients, getPatient, getTimeline, listPatientScans, createPatient,
    getScan, getReport, listAnnotations, saveAnnotation, finalizeReport,
    detectTumor,
    listDocuments, getDocument, uploadDocument,
    sendChatMessage,
    getToken, getSavedRole, setSavedRole,
  };
})();
