/* ============================================================
   Shared UI: sidebar, topbar, AI insight panel, timeline, helpers
   window.UI = { Sidebar, Topbar, AIPanel, Timeline, ... }
   ============================================================ */
(function () {
  const { useState } = React;
  const h = (...a) => React.createElement(...a);
  const Icon = window.Icon;

  function Avatar({ name, color, size = 34 }) {
    const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
    return h("div", { className: "avatar", style: { background: color, width: size, height: size, fontSize: size * 0.38 } }, initials);
  }

  function Badge({ kind = "neutral", children, dot }) {
    return h("span", { className: "badge badge--" + kind }, dot && h("i", { className: "dot" }), children);
  }

  function RiskBadge({ risk }) {
    if (risk === "high") return h(Badge, { kind: "risk", dot: true }, "High risk");
    if (risk === "medium") return h(Badge, { kind: "warn", dot: true }, "Medium");
    return h(Badge, { kind: "ok", dot: true }, "Low risk");
  }

  // ---------------- Sidebar ----------------
  function Sidebar({ role, nav, active, onNav, me, onLogout, counts }) {
    return h("aside", { className: "sidebar" },
      h("div", { className: "sidebar__brand" },
        h("div", { style: { width: 32, height: 32, borderRadius: 9, background: "var(--primary)", color: "#fff", display: "grid", placeItems: "center" } },
          h(Icon, { name: "brain", size: 19 })),
        h("div", { className: "name" }, h("b", null, "BrainTumor"), " AI")),
      h("div", { className: "sidebar__sec" }, role === "admin" ? "Administration" : role === "doctor" ? "Clinical" : "My health"),
      nav.map(item => h("button", {
        key: item.id, className: "navitem", "aria-current": active === item.id,
        onClick: () => onNav(item.id),
      }, h(Icon, { name: item.icon, size: 18, style: { className: "ic" } }),
        h("span", null, item.label),
        counts && counts[item.id] != null && h("span", { className: "count" }, counts[item.id]))),
      h("div", { className: "sidebar__foot" },
        h("div", { className: "userchip" },
          h(Avatar, { name: me.name, color: me.color }),
          h("div", { style: { minWidth: 0, flex: 1 } },
            h("div", { className: "nm" }, me.name),
            h("div", { className: "rl" }, me.role)),
          h("button", { className: "navitem", style: { width: "auto", padding: 7 }, title: "Sign out", onClick: onLogout },
            h(Icon, { name: "logout", size: 17 })))),
    );
  }

  // ---------------- Topbar ----------------
  function Topbar({ crumbs, role, onRole, search = true, right }) {
    return h("header", { className: "topbar" },
      h("nav", { className: "crumbs" },
        crumbs.map((c, i) => h(React.Fragment, { key: i },
          i > 0 && h(Icon, { name: "chevR", size: 14, style: { opacity: 0.5 } }),
          c.onClick ? h("a", { onClick: c.onClick }, c.label) : h("span", { className: i === crumbs.length - 1 ? "cur" : "" }, c.label)))),
      search && h("div", { className: "search" },
        h(Icon, { name: "search", size: 15 }),
        h("input", { placeholder: "Search patients, scans, MRN…" })),
      right,
      h("div", { className: "roleswitch", title: "Demo: switch role" },
        ["admin", "doctor", "patient"].map(r =>
          h("button", { key: r, "aria-pressed": role === r, onClick: () => onRole(r) }, r[0].toUpperCase() + r.slice(1)))),
    );
  }

  // ---------------- AI Insight Panel ----------------
  function AIPanel({ scan, mode = "readonly", onFinalize }) {
    const ai = scan.ai;
    const [decision, setDecision] = useState(null);
    const [note, setNote] = useState("");

    const metrics = [
      { l: "Tumor volume", v: ai.metrics.volume, u: ai.metrics.volumeUnit },
      { l: "Peritumoral edema", v: ai.metrics.edema, u: ai.metrics.edemaUnit },
      { l: "Midline shift", v: ai.metrics.midline, u: ai.metrics.midlineUnit },
      { l: "Dice (seg. quality)", v: ai.metrics.dice, u: "" },
    ];

    return h("div", { className: "aipanel" },
      // risk banner
      h("div", { className: "risk-banner" + (ai.risk === "low" ? " is-low" : "") },
        h("div", { className: "ic" }, h(Icon, { name: ai.risk === "low" ? "checkCircle" : "alert", size: 20 })),
        h("div", { style: { flex: 1 } },
          h("div", { className: "t" }, ai.risk === "low" ? "No urgent features detected" : "Urgent review flagged"),
          h("div", { className: "d" }, ai.flag))),

      // classification card
      h("div", { className: "card" },
        h("div", { className: "card__hd" },
          h("div", { className: "stat__ic", style: { width: 30, height: 30 } }, h(Icon, { name: "sparkle", size: 16 })),
          h("div", { className: "grow" },
            h("div", { className: "h3" }, "AI classification"),
            h("div", { className: "muted", style: { fontSize: 12 } }, "Model v3.2 · ", scan.modality)),
          h(Badge, { kind: "blue" }, Math.round(ai.classes[0].conf * 100), "% conf")),
        h("div", { className: "card__bd" },
          h("div", { style: { fontWeight: 600, fontSize: 15, marginBottom: 12 } }, ai.tumorType),
          ai.classes.map(c => h("div", { className: "conf-row", key: c.name },
            h("span", { className: "nm" }, c.name),
            h("div", { className: "conf-bar" }, h("i", { style: { width: Math.round(c.conf * 100) + "%", background: c === ai.classes[0] ? "var(--primary)" : "var(--ink-3)" } })),
            h("span", { className: "pct" }, Math.round(c.conf * 100), "%"))))),

      // metrics
      h("div", { className: "card" },
        h("div", { className: "card__hd" }, h(Icon, { name: "activity", size: 17, style: { color: "var(--primary)" } }), h("div", { className: "h3" }, "Segmentation metrics")),
        h("div", { className: "card__bd" },
          h("div", { className: "metric-grid" },
            metrics.map(m => h("div", { className: "metric", key: m.l },
              h("div", { className: "l" }, m.l),
              h("div", { className: "v" }, m.v, " ", m.u && h("small", null, m.u))))),
          h("div", { className: "divider" }),
          h("div", { className: "row", style: { justifyContent: "space-between", fontSize: 13 } },
            h("span", { className: "muted" }, "Location"), h("b", null, ai.metrics.location)),
          h("div", { className: "row", style: { justifyContent: "space-between", fontSize: 13, marginTop: 6 } },
            h("span", { className: "muted" }, "Enhancement"), h("b", null, ai.metrics.enhancement)))),

      // structured findings
      h("div", { className: "card" },
        h("div", { className: "card__hd" }, h(Icon, { name: "file", size: 16, style: { color: "var(--primary)" } }), h("div", { className: "h3" }, "Structured summary")),
        h("div", { className: "card__bd", style: { paddingTop: 4, paddingBottom: 4 } },
          h("div", { className: "finding" }, h("div", { className: "lab" }, "Findings"), h("p", null, ai.findings)),
          h("div", { className: "finding" }, h("div", { className: "lab" }, "Impression"), h("p", null, ai.impression)),
          h("div", { className: "finding" }, h("div", { className: "lab" }, "Recommendation"), h("p", null, ai.recommendation)))),

      // sign-off (doctor only)
      mode === "doctor" && h("div", { className: "card", style: { borderColor: "var(--primary-300)" } },
        h("div", { className: "card__hd" }, h(Icon, { name: "stethoscope", size: 17, style: { color: "var(--primary)" } }), h("div", { className: "h3" }, "Radiologist sign-off")),
        h("div", { className: "card__bd" },
          h("div", { className: "signoff" },
            h("div", { style: { fontSize: 12.5, color: "var(--ink-2)", marginBottom: 2 } }, "Do you agree with the AI assessment?"),
            h("div", { className: "signoff__choice" },
              [{ k: "agree", ic: "check", l: "Agree" }, { k: "edit", ic: "edit", l: "Edit" }, { k: "reject", ic: "x", l: "Reject" }].map(c =>
                h("button", { key: c.k, className: "sochoice", "data-kind": c.k, "aria-pressed": decision === c.k, onClick: () => setDecision(c.k) },
                  h(Icon, { name: c.ic, size: 16 }), c.l))),
            h("textarea", { className: "textarea", placeholder: decision === "reject" ? "Reason for rejecting AI output and your assessment…" : "Clinical notes, addendum, or corrections to the AI summary…", value: note, onChange: e => setNote(e.target.value) }),
            h("button", { className: "btn btn--primary btn--block btn--lg", disabled: !decision, onClick: () => onFinalize && onFinalize({ decision, note }) },
              h(Icon, { name: "shield", size: 16 }), "Finalize & publish report"))),
      ),
    );
  }

  window.UI = { Avatar, Badge, RiskBadge, Sidebar, Topbar, AIPanel };
})();
