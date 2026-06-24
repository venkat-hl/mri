/* ============================================================
   ADMIN app — upload + patient assignment dashboard
   window.AdminApp
   ============================================================ */
(function () {
  const { useState, useEffect } = React;
  const h = (...a) => React.createElement(...a);
  const Icon = window.Icon;
  const { Avatar, Badge, RiskBadge, Sidebar, Topbar } = window.UI;
  const API = window.API;

  const NAV = [
    { id: "overview", icon: "grid", label: "Overview" },
    { id: "uploads", icon: "upload", label: "Upload queue" },
    { id: "patients", icon: "users", label: "Patients" },
    { id: "accounts", icon: "shield", label: "Accounts" },
  ];

  function AdminApp({ onRole, onLogout, user }) {
    const [page, setPage] = useState("uploads");
    const [patients, setPatients] = useState([]);
    const [queue, setQueue] = useState([]);
    const me = { name: user ? user.full_name : "Admin", role: "Upload & records", color: "oklch(0.5 0.04 255)" };

    useEffect(() => {
      API.listPatients().then(ps => setPatients(ps || []));
    }, []);

    const counts = { uploads: queue.filter(q => !q.done).length, patients: patients.length };

    return h("div", { className: "app" },
      h(Sidebar, { role: "admin", nav: NAV, active: page, onNav: setPage, me, onLogout, counts }),
      h("div", { className: "main" },
        h(Topbar, { role: "admin", onRole, crumbs: [{ label: "Admin" }, { label: NAV.find(n => n.id === page).label }] }),
        h("div", { className: "page" }, h("div", { className: "page__pad" },
          page === "overview" && h(Overview, { setPage, patients }),
          page === "uploads" && h(Uploads, { queue, setQueue, patients }),
          page === "patients" && h(Patients, { patients, setPatients }),
          page === "accounts" && h(Accounts),
        ))));
  }

  function Overview({ setPage, patients }) {
    const urgent = patients.filter(p => p.risk === "high");
    const stats = [
      { ic: "users",  v: patients.length, l: "Active patients" },
      { ic: "upload", v: "—", l: "Pending uploads" },
      { ic: "layers", v: "—", l: "Scans this month" },
      { ic: "alert",  v: urgent.length, l: "Urgent flags", risk: urgent.length > 0 },
    ];
    return h(React.Fragment, null,
      h("div", { className: "page__head" }, h("div", { className: "grow" },
        h("h1", { className: "h1" }, "System overview"),
        h("p", { className: "sub" }, "Imaging operations across all patients and clinicians."))),
      h("div", { className: "grid", style: { gridTemplateColumns: "repeat(4,1fr)", marginBottom: 22 } },
        stats.map(s => h("div", { className: "stat", key: s.l },
          h("div", { className: "between" },
            h("div", null, h("div", { className: "v", style: s.risk ? { color: "var(--risk)" } : null }, s.v), h("div", { className: "l" }, s.l)),
            h("div", { className: "stat__ic", style: s.risk ? { background: "var(--risk-bg)", color: "var(--risk)" } : null }, h(Icon, { name: s.ic, size: 18 })))))),
      h("div", { className: "grid", style: { gridTemplateColumns: "1.4fr 1fr" } },
        h("div", { className: "card" },
          h("div", { className: "card__hd" }, h("div", { className: "h3 grow" }, "Quick upload"),
            h("button", { className: "btn btn--soft", onClick: () => setPage("uploads") }, "Open queue")),
          h("div", { className: "muted", style: { fontSize: 13, padding: "12px 0" } }, "Go to Upload queue to add NIfTI scans and documents.")),
        h("div", { className: "card" },
          h("div", { className: "card__hd" }, h("div", { className: "h3" }, "Urgent attention")),
          h("div", { className: "card__bd", style: { display: "flex", flexDirection: "column", gap: 12 } },
            urgent.length === 0
              ? h("div", { className: "muted", style: { fontSize: 13 } }, "No urgent cases.")
              : urgent.map(p =>
                h("div", { className: "between", key: p.id },
                  h("div", { className: "pid" }, h(Avatar, { name: p.full_name, color: p.avatar_color || "oklch(0.55 0.115 248)", size: 30 }),
                    h("div", null, h("div", { className: "nm", style: { fontSize: 13 } }, p.full_name), h("div", { className: "meta" }, p.condition))),
                  h(RiskBadge, { risk: p.risk })))))));
  }

  function Uploads({ queue, setQueue, patients }) {
    const [selectedFile, setSelectedFile] = useState(null);
    const [selectedPatient, setSelectedPatient] = useState("");
    const [uploading, setUploading] = useState(false);
    const [uploadStatus, setUploadStatus] = useState(null);
    const fileInputRef = React.useRef(null);

    const isNii = f => f && (f.name.endsWith(".nii") || f.name.endsWith(".nii.gz"));
    const isDoc = f => f && (f.name.endsWith(".pdf") || f.name.match(/\.(png|jpg|jpeg|tiff|webp)$/i));

    const handleFile = (f) => { setSelectedFile(f); setUploadStatus(null); };

    const handleUpload = async () => {
      if (!selectedFile || !selectedPatient) return;
      setUploading(true); setUploadStatus(null);
      try {
        let result;
        if (isNii(selectedFile)) {
          result = await API.detectTumor(selectedFile, selectedPatient);
          setUploadStatus({ kind: "ok", msg: `Scan processed. Scan ID: ${result.scan_id}` });
        } else {
          result = await API.uploadDocument(selectedFile, selectedPatient);
          setUploadStatus({ kind: "ok", msg: `Document uploaded. OCR complete.` });
        }
        setQueue(q => [...q, {
          id: result.scan_id || result.id,
          file: selectedFile.name,
          kind: isNii(selectedFile) ? "nii" : "doc",
          size: (selectedFile.size / 1048576).toFixed(1) + " MB",
          uploaded: "just now",
          assigned: selectedPatient,
          done: true,
        }]);
        setSelectedFile(null); setSelectedPatient("");
        if (fileInputRef.current) fileInputRef.current.value = "";
      } catch (e) {
        setUploadStatus({ kind: "err", msg: e.message || "Upload failed" });
      } finally { setUploading(false); }
    };

    const done = queue.filter(q => q.done);

    return h(React.Fragment, null,
      h("div", { className: "page__head" },
        h("div", { className: "grow" },
          h("h1", { className: "h1" }, "Upload & assignment"),
          h("p", { className: "sub" }, "Attach NIfTI scans and scanned documents to the correct patient record.")),
        h("button", { className: "btn btn--ghost", onClick: () => fileInputRef.current && fileInputRef.current.click() },
          h(Icon, { name: "folder", size: 16 }), "Browse files")),
      h("div", {
        className: "dropzone",
        style: { marginBottom: 22, cursor: "pointer" },
        onClick: () => fileInputRef.current && fileInputRef.current.click(),
        onDragOver: e => e.preventDefault(),
        onDrop: e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); },
      },
        h("input", { type: "file", ref: fileInputRef, style: { display: "none" }, accept: ".nii,.nii.gz,.pdf,.png,.jpg,.jpeg,.tiff,.webp", onChange: e => e.target.files[0] && handleFile(e.target.files[0]) }),
        h("div", { className: "ic" }, h(Icon, { name: "upload", size: 22 })),
        selectedFile
          ? h("div", { style: { fontWeight: 600, fontSize: 15 } }, selectedFile.name)
          : h("div", { style: { fontWeight: 600, fontSize: 15 } }, "Drop NIfTI (.nii / .nii.gz) or scanned PDFs here"),
        h("div", { className: "muted", style: { fontSize: 13, marginTop: 4 } }, "Documents are OCR-processed automatically · Max 512 MB per file")),

      selectedFile && h("div", { className: "card", style: { marginBottom: 18 } },
        h("div", { className: "card__hd" }, h("div", { className: "h3 grow" }, "Assign & upload")),
        h("div", { className: "card__bd", style: { display: "flex", gap: 12, alignItems: "center" } },
          h("select", { className: "assign-sel", style: { flex: 1 }, value: selectedPatient, onChange: e => setSelectedPatient(e.target.value) },
            h("option", { value: "" }, "Select patient…"),
            patients.map(p => h("option", { key: p.id, value: p.id }, p.full_name, " · ", p.mrn || p.id))),
          h("button", { className: "btn btn--primary", disabled: !selectedPatient || uploading, onClick: handleUpload },
            uploading ? "Uploading…" : h(React.Fragment, null, h(Icon, { name: "upload", size: 15 }), isNii(selectedFile) ? "Run AI + Save" : "OCR + Save")),
          uploadStatus && h("div", { style: { fontSize: 13, color: uploadStatus.kind === "ok" ? "var(--ok)" : "var(--risk)" } }, uploadStatus.msg))),

      done.length > 0 && h("div", { className: "card" },
        h("div", { className: "card__hd" }, h("div", { className: "h3 grow" }, "Completed uploads"), h(Badge, { kind: "ok" }, done.length, " done")),
        done.map(u => {
          const pt = patients.find(p => p.id === u.assigned);
          return h("div", { className: "queue-item", key: u.id },
            h("div", { className: "filetype " + u.kind }, u.kind === "nii" ? "NII" : "PDF"),
            h("div", { style: { flex: 1, minWidth: 0 } },
              h("div", { style: { fontWeight: 600, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis" } }, u.file),
              h("div", { className: "muted", style: { fontSize: 12 } }, u.size, " · ", u.uploaded)),
            h(Badge, { kind: "ok", dot: true }, pt ? pt.full_name : "Assigned"));
        })));
  }

  const EMPTY_FORM = { full_name: "", dob: "", sex: "", mrn: "", condition: "", risk: "low", user_id: "" };

  function Patients({ patients, setPatients }) {
    const [showModal, setShowModal] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);
    const [formErr, setFormErr] = useState(null);

    const field = (key) => ({
      value: form[key],
      onChange: (e) => setForm(f => ({ ...f, [key]: e.target.value })),
    });

    const handleSave = async () => {
      if (!form.full_name.trim()) { setFormErr("Full name is required."); return; }
      setSaving(true); setFormErr(null);
      try {
        const payload = { ...form };
        if (!payload.user_id) delete payload.user_id;
        if (!payload.dob) delete payload.dob;
        if (!payload.mrn) delete payload.mrn;
        if (!payload.condition) delete payload.condition;
        const created = await API.createPatient(payload);
        setPatients(ps => [created, ...ps]);
        setShowModal(false);
        setForm(EMPTY_FORM);
      } catch (e) {
        setFormErr(e.message || "Failed to create patient.");
      } finally { setSaving(false); }
    };

    const inputStyle = { width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--ink-1)", fontSize: 13.5 };
    const labelStyle = { fontSize: 12, color: "var(--ink-3)", marginBottom: 4, display: "block" };

    return h(React.Fragment, null,
      h("div", { className: "card" },
        h("div", { className: "card__hd" },
          h("div", { className: "h3 grow" }, "All patients"),
          h("button", { className: "btn btn--primary", onClick: () => setShowModal(true) },
            h(Icon, { name: "plus", size: 15 }), "New patient")),
        h("table", { className: "tbl" },
          h("thead", null, h("tr", null, ["Patient", "MRN", "Condition", "Risk", "Assigned doctor"].map(c => h("th", { key: c }, c)))),
          h("tbody", null, patients.length === 0
            ? h("tr", null, h("td", { colSpan: 5, className: "muted", style: { textAlign: "center", padding: 24 } }, "No patients yet."))
            : patients.map(p => h("tr", { key: p.id },
                h("td", null, h("div", { className: "pid" }, h(Avatar, { name: p.full_name, color: p.avatar_color || "oklch(0.55 0.115 248)", size: 32 }),
                  h("div", null, h("div", { className: "nm" }, p.full_name), h("div", { className: "meta" }, p.sex, " · ", p.id)))),
                h("td", { className: "num muted" }, p.mrn || "—"),
                h("td", null, p.condition || "—"),
                h("td", null, h(RiskBadge, { risk: p.risk || "low" })),
                h("td", { className: "muted" }, p.assigned_doctor_id || "Unassigned")))))),

      showModal && h("div", {
        style: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" },
        onClick: (e) => { if (e.target === e.currentTarget) setShowModal(false); }
      },
        h("div", { style: { background: "var(--surface-1)", borderRadius: "var(--radius)", padding: 28, width: 480, maxWidth: "calc(100vw - 32px)", boxShadow: "0 24px 64px rgba(0,0,0,0.5)" } },
          h("div", { className: "between", style: { marginBottom: 20 } },
            h("div", { className: "h3" }, "New patient"),
            h("button", { style: { background: "none", border: "none", color: "var(--ink-3)", cursor: "pointer", fontSize: 20, lineHeight: 1 }, onClick: () => setShowModal(false) }, "×")),

          h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 } },
            h("div", { style: { gridColumn: "1 / -1" } },
              h("label", { style: labelStyle }, "Full name *"),
              h("input", { style: inputStyle, placeholder: "e.g. John Smith", ...field("full_name") })),

            h("div", null,
              h("label", { style: labelStyle }, "Date of birth"),
              h("input", { type: "date", style: inputStyle, ...field("dob") })),
            h("div", null,
              h("label", { style: labelStyle }, "Sex"),
              h("select", { style: inputStyle, ...field("sex") },
                h("option", { value: "" }, "Select…"),
                h("option", { value: "Male" }, "Male"),
                h("option", { value: "Female" }, "Female"),
                h("option", { value: "Other" }, "Other"))),

            h("div", null,
              h("label", { style: labelStyle }, "MRN"),
              h("input", { style: inputStyle, placeholder: "Medical record number", ...field("mrn") })),
            h("div", null,
              h("label", { style: labelStyle }, "Risk level"),
              h("select", { style: inputStyle, ...field("risk") },
                h("option", { value: "low" }, "Low"),
                h("option", { value: "medium" }, "Medium"),
                h("option", { value: "high" }, "High"))),

            h("div", { style: { gridColumn: "1 / -1" } },
              h("label", { style: labelStyle }, "Condition / diagnosis"),
              h("input", { style: inputStyle, placeholder: "e.g. Glioblastoma multiforme", ...field("condition") })),

            h("div", { style: { gridColumn: "1 / -1" } },
              h("label", { style: labelStyle }, "User ID (optional — link to a Supabase user account)"),
              h("input", { style: inputStyle, placeholder: "Paste user UUID if account already exists", ...field("user_id") }))),

          formErr && h("div", { style: { marginTop: 12, fontSize: 13, color: "var(--risk)" } }, formErr),

          h("div", { className: "row", style: { justifyContent: "flex-end", gap: 10, marginTop: 20 } },
            h("button", { className: "btn btn--ghost", onClick: () => setShowModal(false) }, "Cancel"),
            h("button", { className: "btn btn--primary", disabled: saving, onClick: handleSave }, saving ? "Saving…" : "Create patient")))));
  }

  function Accounts() {
    return h("div", { className: "card" },
      h("div", { className: "card__bd" },
        h("div", { className: "muted", style: { fontSize: 13 } }, "Account management is done via the Supabase dashboard. Users sign up with their role set in user metadata.")));
  }

  window.AdminApp = AdminApp;
})();
