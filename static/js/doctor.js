/* ============================================================
   DOCTOR app — patient list → timeline → scan detail (viewer + AI + sign-off)
   window.DoctorApp
   ============================================================ */
(function () {
  const { useState, useEffect } = React;
  const h = (...a) => React.createElement(...a);
  const Icon = window.Icon;
  const { Avatar, Badge, RiskBadge, Sidebar, Topbar, AIPanel } = window.UI;
  const API = window.API;
  const MRIViewer = window.MRIViewer;
  const RealMRIViewer = window.RealMRIViewer;
  const NiiVueViewer = window.NiiVueViewer;

  const NAV = [
    { id: "list", icon: "users", label: "Patients" },
    { id: "worklist", icon: "list", label: "Review worklist" },
    { id: "reports", icon: "file", label: "My reports" },
  ];

  function DoctorApp({ onRole, onLogout, user }) {
    const [view, setView] = useState({ name: "list" });
    const [page, setPage] = useState("list");
    const [finalized, setFinalized] = useState(null);
    const [patients, setPatients] = useState([]);
    const me = { name: user ? user.full_name : "Doctor", role: "Neuroradiologist", color: "oklch(0.55 0.115 248)" };

    useEffect(() => { API.listPatients().then(ps => setPatients(ps || [])); }, []);

    const counts = { list: patients.length, worklist: patients.filter(p => p.risk === "high").length };

    const openPatient = (pid) => { setView({ name: "timeline", pid }); setPage("list"); };
    const openScan = (pid, scan) => setView({ name: "scan", pid, scan });

    const crumbs = [{ label: "Patients", onClick: () => setView({ name: "list" }) }];
    if (view.name === "timeline" || view.name === "scan") {
      const p = patients.find(x => x.id === view.pid) || {};
      crumbs.push({ label: p.full_name || "Patient", onClick: () => setView({ name: "timeline", pid: view.pid }) });
    }
    if (view.name === "scan") crumbs.push({ label: "Scan " + view.scan.id });

    const onNav = (id) => { setPage(id); setView({ name: id === "list" ? "list" : id }); };

    return h("div", { className: "app" },
      h(Sidebar, { role: "doctor", nav: NAV, active: page, onNav, me, onLogout, counts }),
      h("div", { className: "main" },
        h(Topbar, { role: "doctor", onRole, crumbs }),
        h("div", { className: "page" },
          (view.name === "list" || page === "worklist" || page === "reports") && page !== "list2" &&
            (page === "reports" ? h("div", { className: "page__pad" }, h(Reports))
             : h("div", { className: "page__pad" }, h(PatientList, { worklist: page === "worklist", onOpen: openPatient, patients }))),
          view.name === "timeline" && h("div", { className: "page__pad" }, h(PatientTimeline, { pid: view.pid, patients, onScan: openScan })),
          view.name === "scan" && h(ScanDetail, { pid: view.pid, scan: view.scan, patients, finalized, onFinalize: (r) => setFinalized(r) }),
        )));
  }

  // ---------- patient list ----------
  function PatientList({ worklist, onOpen, patients }) {
    const list = worklist ? patients.filter(p => p.risk === "high") : patients;
    return h(React.Fragment, null,
      h("div", { className: "page__head" }, h("div", { className: "grow" },
        h("h1", { className: "h1" }, worklist ? "Review worklist" : "Patients"),
        h("p", { className: "sub" }, worklist ? "High-risk scans awaiting your sign-off." : "All patients under your care."))),
      h("div", { className: "card" },
        h("table", { className: "tbl" },
          h("thead", null, h("tr", null, ["Patient", "Condition", "AI risk", "MRN", "Last scan", ""].map(c => h("th", { key: c }, c)))),
          h("tbody", null, list.length === 0
            ? h("tr", null, h("td", { colSpan: 6, className: "muted", style: { textAlign: "center", padding: 24 } }, "No patients."))
            : list.map(p => h("tr", { key: p.id, className: "clickable", onClick: () => onOpen(p.id) },
            h("td", null, h("div", { className: "pid" }, h(Avatar, { name: p.full_name, color: p.avatar_color || "oklch(0.55 0.115 248)", size: 34 }),
              h("div", null, h("div", { className: "nm" }, p.full_name), h("div", { className: "meta" }, p.sex, " · ", p.mrn || p.id)))),
            h("td", null, p.condition),
            h("td", null, h(RiskBadge, { risk: p.risk })),
            h("td", { className: "num muted" }, p.mrn || "—"),
            h("td", { className: "num muted" }, p.created_at ? p.created_at.slice(0,10) : "—"),
            h("td", null, h(Icon, { name: "chevR", size: 16, style: { color: "var(--ink-3)" } })))))) ));
  }

  // ---------- timeline ----------
  function PatientTimeline({ pid, patients, onScan }) {
    const p = patients.find(x => x.id === pid) || {};
    const [items, setItems] = useState([]);
    const [docOpen, setDocOpen] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
      setLoading(true);
      API.getTimeline(pid).then(data => { setItems(data || []); setLoading(false); });
    }, [pid]);

    return h(React.Fragment, null,
      h("div", { className: "card", style: { marginBottom: 20 } }, h("div", { className: "card__bd", style: { display: "flex", alignItems: "center", gap: 18 } },
        h(Avatar, { name: p.full_name || "?", color: p.avatar_color || "oklch(0.55 0.115 248)", size: 56 }),
        h("div", { style: { flex: 1 } },
          h("div", { className: "row", style: { gap: 12 } }, h("h1", { className: "h2" }, p.full_name || "Patient"), h(RiskBadge, { risk: p.risk || "low" })),
          h("div", { className: "muted", style: { fontSize: 13.5, marginTop: 4 } }, p.sex || "", " · DOB ", p.dob || "—", " · ", p.mrn || p.id)),
        h("div", { style: { textAlign: "right" } },
          h("div", { className: "eyebrow" }, "Working dx"), h("div", { style: { fontWeight: 600, marginTop: 3 } }, p.condition || "—")),
        h("button", { className: "btn btn--ghost" }, h(Icon, { name: "download", size: 15 }), "Export"))),

      h("div", { className: "between", style: { marginBottom: 14 } },
        h("h3", { className: "h3" }, "Clinical timeline"),
        h("div", { className: "wrap" }, ["All", "Scans", "Reports", "Documents"].map((f, i) => h("button", { key: f, className: "chip", "aria-pressed": i === 0 }, f)))),

      h("div", { className: "timeline" },
        items.map(it => h("div", { className: "tl-item", key: it.id },
          h("div", { className: "tl-item__dot " + (it.risk ? "is-risk" : "is-" + it.type) },
            h(Icon, { name: it.type === "scan" ? "layers" : it.type === "report" ? "file" : "folder", size: 11 })),
          h("div", { className: "tl-date" }, fmt(it.date), it.risk && h("span", { style: { marginLeft: 8 } }, h(Badge, { kind: "risk", dot: true }, "Urgent"))),
          it.type === "scan"
            ? h("div", { className: "tl-card clickable", onClick: () => onScan(pid, it) },
                h("div", { className: "between" },
                  h("div", { className: "row" }, h("div", { className: "filetype nii" }, "MRI"),
                    h("div", null,
                      h("div", { style: { fontWeight: 600, fontSize: 14 } }, it.modality || "Brain MRI"),
                      h("div", { className: "muted", style: { fontSize: 12.5 } }, it.status))),
                  h("button", { className: "btn btn--soft" }, "Open viewer ", h(Icon, { name: "chevR", size: 14 }))))
            : it.type === "doc"
            ? h("div", { className: "tl-card clickable", onClick: () => setDocOpen(docOpen === it.id ? null : it.id) },
                h("div", { className: "between" },
                  h("div", { className: "row" }, h("div", { className: "filetype doc" }, "PDF"),
                    h("div", null,
                      h("div", { style: { fontWeight: 600, fontSize: 14 } }, it.original_name || "Document"),
                      h("div", { className: "muted", style: { fontSize: 12.5 } }, it.source_type, " · OCR ✓"))),
                  h("button", { className: "btn btn--ghost" }, h(Icon, { name: docOpen === it.id ? "eyeOff" : "eye", size: 14 }), docOpen === it.id ? "Hide" : "View OCR")),
                docOpen === it.id && h("div", { className: "ocr", style: { marginTop: 12, whiteSpace: "pre-wrap" } },
                  it.ai_summary || "No extracted text."))
            : h("div", { className: "tl-card" },
                h("div", { style: { fontWeight: 600, fontSize: 14 } }, "Report"),
                h("div", { className: "muted", style: { fontSize: 12.5 } }, it.decision || it.status))))));
  }

  // ---------- scan detail (the centerpiece) ----------
  function ScanDetail({ pid, scan, patients, finalized, onFinalize }) {
    const [viewTab, setViewTab] = useState("slices");
    const p = patients.find(x => x.id === pid) || {};
    const ar = (scan.analysis_results || [{}]);
    const aiData = Array.isArray(ar) ? ar[0] : ar;
    const sf = aiData ? (aiData.structured_findings || {}) : {};

    // Map DB row into the shape AIPanel expects
    // Build classes array in shape AIPanel expects: [{name, conf}]
    const rawClasses = sf.classes || (aiData && aiData.segmentation_metrics && []) || [];
    const classes = rawClasses.length > 0
      ? rawClasses.map(c => ({ name: c.label || c.name || "Unknown", conf: (c.score != null ? c.score / 100 : c.conf) || 0 }))
      : [{ name: aiData ? (aiData.classifier_label || "Pending") : "Pending", conf: aiData ? ((aiData.confidence || 0) / 100) : 0 }];

    const scanForPanel = {
      id: scan.id,
      modality: scan.modality || "MRI",
      sequence: scan.sequence || "T1",
      voxel: "1.0 × 1.0 × 1.0 mm",
      slices: 176,
      dims: "256 × 256 × 176",
      date: scan.created_at ? scan.created_at.slice(0, 10) : "—",
      ai: {
        status: "complete",
        risk: sf.risk || "low",
        tumorType: aiData ? (aiData.classifier_label || "Pending analysis") : "Pending analysis",
        classes,
        metrics: {
          volume: sf.metrics && sf.metrics.tumor_percentage != null ? sf.metrics.tumor_percentage + "%" : "—",
          volumeUnit: "of scan",
          edema: sf.metrics && sf.metrics.edema_pixels != null ? sf.metrics.edema_pixels : "—",
          edemaUnit: "px",
          midline: "—", midlineUnit: "",
          dice: "—",
          location: "Temporal lobe",
          enhancement: sf.risk === "high" ? "Yes" : "None detected",
        },
        findings: sf.findings || "AI segmentation complete.",
        impression: sf.impression || (aiData && aiData.ai_summary) || "Awaiting radiologist review.",
        recommendation: sf.recommendation || "Correlate with clinical presentation.",
        flag: sf.risk === "high" ? "High-risk features detected." : "No urgent features flagged.",
      },
    };

    const handleFinalize = async (result) => {
      try {
        await API.finalizeReport(scan.id, result.decision, result.note, "final");
        // Save text annotation to DB
        if (result.note) {
          await API.saveAnnotation(scan.id, {
            shape_type: "signoff",
            note: result.note,
            decision: result.decision,
          });
        }
        onFinalize(result);
      } catch (e) { console.error("Finalize failed:", e); }
    };

    return h("div", { style: { padding: "22px 28px 48px", maxWidth: 1400, margin: "0 auto" } },
      h("div", { className: "between", style: { marginBottom: 16 } },
        h("div", null,
          h("div", { className: "row", style: { gap: 10 } },
            h("h1", { className: "h2" }, "Scan ", scan.id.slice(0, 8)),
            aiData ? h(Badge, { kind: "blue" }, "AI complete") : h(Badge, { kind: "warn" }, "Pending")),
          h("div", { className: "muted", style: { fontSize: 13, marginTop: 3 } },
            p.full_name || "Patient", " · ", scanForPanel.modality, " · ", scanForPanel.date)),
        h("div", { className: "wrap" },
          finalized && h(Badge, { kind: "ok", dot: true }, "Report ", finalized.decision === "reject" ? "amended" : "finalized"))),
      h("div", { className: "scan-layout" },
        h("div", null,
          h("div", { className: "tabbar", style: { marginBottom: 10 } },
            h("button", { "aria-pressed": viewTab === "slices", onClick: () => setViewTab("slices") }, "2D Slices"),
            scan.nii_url && h("button", { "aria-pressed": viewTab === "3d", onClick: () => setViewTab("3d") }, "3D Volume")),
          viewTab === "3d" && scan.nii_url
            ? h(NiiVueViewer, { niiUrl: scan.nii_url })
            : sf.slice_count > 0
              ? h(RealMRIViewer, { scan: { id: scan.id, slice_count: sf.slice_count, slice_base: sf.slice_base, has_overlay: !!sf.metrics, modality: scan.modality || "MRI" }, mode: "doctor" })
              : h(MRIViewer, { scan: scanForPanel, mode: "doctor" }),
          h("div", { className: "card", style: { marginTop: 16 } },
            h("div", { className: "card__hd" }, h(Icon, { name: "edit", size: 16, style: { color: "var(--primary)" } }), h("div", { className: "h3 grow" }, "Annotations & notes"),
              h("span", { className: "muted", style: { fontSize: 12 } }, "Draw on the slice using the toolbar")),
            h("div", { className: "card__bd" },
              finalized && finalized.note
                ? h("div", { style: { fontSize: 13.5, lineHeight: 1.55 } }, h("b", null, "Your note: "), finalized.note)
                : h("div", { className: "muted", style: { fontSize: 13 } }, "Use the tools on the viewer to mark regions of interest. Saved with this scan.")))),
        h("div", null, h(AIPanel, { scan: scanForPanel, mode: "doctor", onFinalize: handleFinalize }))));
  }

  function Reports() {
    const [reports, setReports] = useState([]);
    useEffect(() => { /* Reports are per-scan; this is a placeholder for a /api/reports endpoint */ }, []);
    return h(React.Fragment, null,
      h("div", { className: "page__head" }, h("div", { className: "grow" }, h("h1", { className: "h1" }, "My reports"), h("p", { className: "sub" }, "Reports you have finalized."))),
      h("div", { className: "card" }, h("div", { className: "card__bd muted", style: { fontSize: 13, padding: 24, textAlign: "center" } },
        "Open a scan from the Patients list and finalize the report there. Finalized reports will appear here.")));
  }

  // helpers
  function fmt(d) {
    if (!d) return "—";
    const str = d.length > 10 ? d.slice(0, 10) : d;
    const D = new Date(str + "T00:00");
    return D.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
  function syntheticTimeline(_p) {
    return [];
  }

  window.DoctorApp = DoctorApp;
})();
