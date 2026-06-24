/* ============================================================
   PATIENT app — my scans timeline → read-only detail → chatbot
   window.PatientApp
   ============================================================ */
(function () {
  const { useState, useRef, useEffect } = React;
  const h = (...a) => React.createElement(...a);
  const Icon = window.Icon;
  const { Avatar, Badge, Sidebar, Topbar } = window.UI;
  const API = window.API;
  const MRIViewer = window.MRIViewer;
  const RealMRIViewer = window.RealMRIViewer;

  const NAV = [
    { id: "scans", icon: "layers", label: "My scans" },
    { id: "reports", icon: "file", label: "My reports" },
    { id: "chat", icon: "chat", label: "Ask a question" },
  ];

  function PatientApp({ onRole, onLogout, user }) {
    const [page, setPage] = useState("scans");
    const [openScan, setOpenScan] = useState(null); // null or scan object
    const [patient, setPatient] = useState(null);
    const me = { name: user ? user.full_name : "Patient", role: "Patient", color: "oklch(0.55 0.115 248)" };

    useEffect(() => {
      // Load this patient's own record
      API.listPatients().then(ps => { if (ps && ps.length) setPatient(ps[0]); });
    }, []);

    const crumbs = page === "scans" && openScan
      ? [{ label: "My scans", onClick: () => setOpenScan(null) }, { label: openScan.created_at ? openScan.created_at.slice(0, 10) : "Scan" }]
      : [{ label: NAV.find(n => n.id === page).label }];

    if (!patient) return h("div", { className: "app" },
      h("div", { className: "main" }, h("div", { style: { padding: 40, color: "var(--ink-3)", fontSize: 14 } }, "Loading your records…")));

    return h("div", { className: "app" },
      h(Sidebar, { role: "patient", nav: NAV, active: page, onNav: (id) => { setPage(id); setOpenScan(null); }, me, onLogout }),
      h("div", { className: "main" },
        h(Topbar, { role: "patient", onRole, crumbs, search: false }),
        h("div", { className: "page" },
          page === "scans" && !openScan && h("div", { className: "page__pad" }, h(MyScans, { patient, onOpen: (s) => setOpenScan(s) })),
          page === "scans" && openScan && h("div", { style: { padding: "22px 28px 48px", maxWidth: 1320, margin: "0 auto" } }, h(ScanReadonly, { patient, scan: openScan })),
          page === "reports" && h("div", { className: "page__pad" }, h(MyReports, { patient })),
          page === "chat" && h(ChatPanel, { patient }),
        )));
  }

  function MyScans({ patient, onOpen }) {
    const [scans, setScans] = useState([]);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
      if (patient) {
        API.listPatientScans(patient.id).then(s => { setScans(s || []); setLoading(false); });
      }
    }, [patient && patient.id]);

    const firstName = (patient.full_name || "").split(" ")[0] || "there";
    const latestReviewed = scans.find(s => s.analysis_results && s.analysis_results.length > 0);

    return h(React.Fragment, null,
      h("div", { className: "page__head" }, h("div", { className: "grow" },
        h("h1", { className: "h1" }, "Hello, ", firstName),
        h("p", { className: "sub" }, "Your scan history and what your care team found, explained simply."))),
      // reassurance / status banner

      latestReviewed && h("div", { className: "card", style: { marginBottom: 22, borderColor: "var(--primary-300)", background: "var(--primary-50)" } },
        h("div", { className: "card__bd", style: { display: "flex", alignItems: "center", gap: 16 } },
          h("div", { className: "stat__ic", style: { width: 44, height: 44, background: "var(--primary)", color: "#fff" } }, h(Icon, { name: "stethoscope", size: 22 })),
          h("div", { style: { flex: 1 } },
            h("div", { style: { fontWeight: 600, fontSize: 15 } }, "Your latest scan has been reviewed"),
            h("div", { className: "muted", style: { fontSize: 13.5, marginTop: 2 } }, "Open your scan to read results in plain language.")),
          h("button", { className: "btn btn--primary", onClick: () => onOpen(latestReviewed) }, "View results", h(Icon, { name: "chevR", size: 15 })))),
      h("h3", { className: "h3", style: { marginBottom: 14 } }, "Scan history"),
      loading ? h("div", { className: "muted", style: { fontSize: 13, padding: 24 } }, "Loading…")
      : scans.length === 0 ? h("div", { className: "muted", style: { fontSize: 13, padding: 24 } }, "No scans yet.")
      : h("div", { className: "timeline" },
        scans.map(s => {
          const ar = s.analysis_results && s.analysis_results[0];
          return h("div", { className: "tl-item", key: s.id },
            h("div", { className: "tl-item__dot is-scan" }, h(Icon, { name: "layers", size: 11 })),
            h("div", { className: "tl-date" }, fmt(s.created_at)),
            h("div", { className: "tl-card clickable", onClick: () => onOpen(s) },
              h("div", { className: "between" },
                h("div", { className: "row" }, h("div", { className: "filetype nii" }, "MRI"),
                  h("div", null,
                    h("div", { style: { fontWeight: 600, fontSize: 14 } }, s.modality || "Brain MRI"),
                    h("div", { className: "muted", style: { fontSize: 12.5 } }, ar ? "AI complete · " + (ar.classifier_label || "—") : "Processing"))),
                h("div", { className: "row" },
                  ar ? h(Badge, { kind: "ok", dot: true }, "Reviewed") : h(Badge, { kind: "warn" }, "Pending"),
                  h("button", { className: "btn btn--soft" }, "Open ", h(Icon, { name: "chevR", size: 14 }))))));
        })));
  }

  function ScanReadonly({ patient, scan }) {
    const [tab, setTab] = useState("results");
    const ar = scan.analysis_results && scan.analysis_results[0];
    const sf = ar ? (ar.structured_findings || {}) : {};

    const scanForViewer = {
      id: scan.id,
      modality: scan.modality || "MRI",
      sequence: scan.sequence || "T1",
      slices: 176,
      voxel: "1.0 × 1.0 × 1.0 mm",
      ai: { risk: sf.risk || "low" },
    };

    return h(React.Fragment, null,
      h("div", { className: "between", style: { marginBottom: 16 } },
        h("div", null,
          h("h1", { className: "h2" }, scan.modality || "Brain MRI", " · ", fmt(scan.created_at)),
          h("div", { className: "muted", style: { fontSize: 13, marginTop: 3 } }, "Reviewed by your doctor")),
        h("button", { className: "btn btn--ghost" }, h(Icon, { name: "download", size: 15 }), "Download summary")),
      h("div", { className: "tabbar" },
        h("button", { "aria-pressed": tab === "results", onClick: () => setTab("results") }, "What we found"),
        h("button", { "aria-pressed": tab === "images", onClick: () => setTab("images") }, "My images"),
        h("button", { "aria-pressed": tab === "history", onClick: () => setTab("history") }, "Past reports")),

      tab === "images" && h("div", { className: "scan-layout", style: { gridTemplateColumns: "1fr 320px" } },
        sf.slice_count > 0
          ? h(RealMRIViewer, { scan: { id: scan.id, slice_count: sf.slice_count, slice_base: sf.slice_base, modality: scan.modality || "MRI" }, mode: "readonly" })
          : h(MRIViewer, { scan: scanForViewer, mode: "readonly" }),
        h("div", { className: "card" }, h("div", { className: "card__bd" },
          h("div", { className: "row", style: { gap: 8, marginBottom: 10 } }, h(Icon, { name: "eye", size: 16, style: { color: "var(--primary)" } }), h("b", null, "Viewing your scan")),
          h("p", { className: "muted", style: { fontSize: 13.5, lineHeight: 1.6, margin: 0 } },
            "These are images from your MRI. The colored outline shows the area being monitored."),
          h("div", { className: "divider" }),
          h("div", { className: "row", style: { gap: 8 } },
            h(Icon, { name: "shield", size: 15, style: { color: "var(--ink-3)" } }),
            h("span", { className: "muted", style: { fontSize: 12.5 } }, "Read-only · annotation tools are reserved for clinicians."))))),

      tab === "results" && h(PatientResults, { scan, ar, sf }),
      tab === "history" && h(MyReports, { patient }));
  }

  function PatientResults({ scan, ar, sf }) {
    const summary = ar ? ar.ai_summary : "No AI summary available yet.";
    const impression = sf ? sf.impression : "";
    const recommendation = sf ? sf.recommendation : "";
    const metrics = ar ? (ar.segmentation_metrics || sf && sf.metrics || {}) : {};

    return h(React.Fragment, null,
      h("div", { className: "compare", style: { marginBottom: 18 } },
        h("div", { className: "compare__col" },
          h("h4", null, h(Icon, { name: "stethoscope", size: 18, style: { color: "var(--primary)" } }), " Your doctor's review"),
          impression
            ? h("p", { style: { fontSize: 14, lineHeight: 1.65, margin: 0 } }, impression)
            : h("p", { className: "muted", style: { fontSize: 14 } }, "Your doctor has not yet finalized a review. Check back soon."),
          recommendation && h("p", { style: { fontSize: 13.5, color: "var(--ink-2)", marginTop: 8 } }, recommendation),
          h("div", { className: "divider" }),
          h("div", { className: "row", style: { gap: 8 } }, h(Badge, { kind: ar ? "ok" : "warn" }, ar ? "AI analysis complete" : "Pending"))),
        h("div", { className: "compare__col is-ai" },
          h("h4", null, h("span", { className: "stat__ic", style: { width: 26, height: 26 } }, h(Icon, { name: "sparkle", size: 14 })), "AI summary"),
          summary
            ? h("p", { style: { fontSize: 14, lineHeight: 1.65, margin: 0 } }, summary)
            : h("p", { className: "muted", style: { fontSize: 14 } }, "Processing…"))),

      Object.keys(metrics).length > 0 && h("div", { className: "card" },
        h("div", { className: "card__hd" }, h(Icon, { name: "activity", size: 16, style: { color: "var(--primary)" } }), h("div", { className: "h3" }, "Your scan in numbers")),
        h("div", { className: "card__bd" }, h("div", { className: "metric-grid", style: { gridTemplateColumns: "repeat(3,1fr)" } },
          [
            ["Tumor coverage", (metrics.tumor_percentage || 0) + "%", "of analyzed pixels"],
            ["Edema pixels", metrics.edema_pixels || 0, "fluid around tumor"],
            ["Enhancing", metrics.enhancing_pixels || 0, "active tumor pixels"],
          ].map(m =>
            h("div", { className: "metric", key: m[0] },
              h("div", { className: "l" }, m[0]),
              h("div", { className: "v", style: { fontSize: 16 } }, m[1]),
              h("div", { className: "muted", style: { fontSize: 11.5, marginTop: 3 } }, m[2])))))),

      h("div", { className: "card", style: { marginTop: 16, background: "var(--surface-2)" } },
        h("div", { className: "card__bd", style: { display: "flex", gap: 14, alignItems: "center" } },
          h(Icon, { name: "chat", size: 22, style: { color: "var(--primary)", flex: "0 0 auto" } }),
          h("div", { style: { flex: 1 } },
            h("b", null, "Have questions about your results?"),
            h("div", { className: "muted", style: { fontSize: 13 } }, "Ask our assistant — it only sees your own records.")),
          h("button", { className: "btn btn--primary", onClick: () => document.dispatchEvent(new CustomEvent("go-chat")) }, "Ask a question"))));
  }

  function MyReports({ patient }) {
    const [reports, setReports] = useState([]);
    useEffect(() => { /* TODO: fetch finalized reports for patient */ }, [patient && patient.id]);
    return h("div", { className: "card" },
      h("div", { className: "card__hd" }, h("div", { className: "h3" }, "Report history")),
      reports.length === 0
        ? h("div", { className: "card__bd muted", style: { fontSize: 13, textAlign: "center", padding: 24 } }, "No finalized reports yet.")
        : h("table", { className: "tbl" },
            h("thead", null, h("tr", null, ["Report", "Date", "Status"].map(c => h("th", { key: c }, c)))),
            h("tbody", null, reports.map(r => h("tr", { key: r.id },
              h("td", { style: { fontWeight: 600 } }, r.id.slice(0, 8)),
              h("td", { className: "num muted" }, fmt(r.created_at)),
              h("td", null, h(Badge, { kind: "ok", dot: true }, r.status)))))));
  }

  // ---------------- Chatbot ----------------
  // (mock answers removed — real Groq API via window.API.sendChatMessage)

  const SUGGEST = [
    "What does my latest result mean?",
    "What is a temporal lobe?",
    "What medications am I on?",
    "Is there anything urgent?",
  ];

  function ChatPanel({ patient }) {
    const firstName = (patient.full_name || "there").split(" ")[0];
    const [msgs, setMsgs] = useState([
      { who: "bot", t: "Hi " + firstName + " — I'm your records assistant. I can explain your reports and documents in plain language. I can only see your own records. What would you like to know?" },
    ]);
    const [input, setInput] = useState("");
    const [sending, setSending] = useState(false);
    const scrollRef = useRef(null);
    useEffect(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs]);

    const send = async (text) => {
      const q = (text || input).trim(); if (!q || sending) return;
      setInput(""); setSending(true);
      setMsgs(m => [...m, { who: "me", t: q }]);
      try {
        const resp = await API.sendChatMessage(q, patient.id);
        setMsgs(m => [...m, { who: "bot", t: resp.answer, src: resp.sources && resp.sources[0] }]);
      } catch (e) {
        setMsgs(m => [...m, { who: "bot", t: "Sorry, the assistant is unavailable right now. Please contact your care team directly." }]);
      } finally { setSending(false); }
    };

    return h("div", { className: "chat" },
      h("div", { className: "chat__scroll", ref: scrollRef },
        msgs.map((m, i) => h("div", { className: "msg " + (m.who === "me" ? "me" : "bot"), key: i },
          h("div", null, m.t),
          m.src && h("div", { className: "src" }, h(Icon, { name: "file", size: 12 }), m.src)))),
      h("div", { className: "chat__suggest" },
        SUGGEST.map(s => h("button", { key: s, className: "chip", onClick: () => send(s) }, s))),
      h("div", { className: "chat__bar" },
        h("input", { placeholder: "Ask about your reports…", value: input, disabled: sending, onChange: e => setInput(e.target.value), onKeyDown: e => e.key === "Enter" && send() }),
        h("button", { className: "iconbtn", disabled: sending, onClick: () => send() }, h(Icon, { name: "send", size: 18 }))));
  }

  function fmt(d) {
    if (!d) return "—";
    const str = d.length > 10 ? d.slice(0, 10) : d;
    const D = new Date(str + "T00:00");
    return D.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  window.PatientApp = PatientApp;
})();
