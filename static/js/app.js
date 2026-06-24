/* ============================================================
   Root — portal landing → role login (real Supabase auth) → app router
   Replaces src/app.jsx from design handoff with real API calls.
   ============================================================ */
(function () {
  const { useState, useEffect } = React;
  const h = (...a) => React.createElement(...a);
  const Icon = window.Icon;

  const ROLES = [
    { id: "doctor",  icon: "stethoscope", t: "Clinician",     d: "Review scans, annotate slices, read AI insight, and sign off reports." },
    { id: "patient", icon: "user",        t: "Patient",        d: "See your scan history, your doctor's review in plain language, and ask questions." },
    { id: "admin",   icon: "shield",      t: "Administrator",  d: "Upload NIfTI scans and documents, and assign them to the right patient record." },
  ];

  // ---- Portal landing ----
  function Landing({ onPick }) {
    return h("div", { className: "portal" },
      h("div", { className: "portal__grid" }),
      h("nav", { className: "portal__nav" },
        h("div", { style: { width: 38, height: 38, borderRadius: 10, background: "var(--primary)", display: "grid", placeItems: "center", color: "#fff" } },
          h(Icon, { name: "brain", size: 22 })),
        h("div", { className: "name" }, "BrainTumor AI"),
        h("div", { className: "badge-secure" }, h(Icon, { name: "shield", size: 14 }), "HIPAA-compliant · encrypted")),
      h("div", { className: "portal__body" },
        h("div", { className: "portal__eyebrow" }, "Clinical MRI intelligence platform"),
        h("h1", { className: "portal__title" }, "Clarity in every scan."),
        h("p", { className: "portal__sub" }, "AI-assisted tumor segmentation, 3D visualization, and a shared record connecting your imaging team, clinicians, and patients."),
        h("div", { className: "portal__choose" }, h(Icon, { name: "user", size: 15 }), "Choose your portal to continue"),
        h("div", { className: "portal__cards" },
          ROLES.map(r => h("button", { key: r.id, className: "portalcard", onClick: () => onPick(r.id) },
            h("div", { className: "portalcard__ic" }, h(Icon, { name: r.icon, size: 26 })),
            h("div", { className: "portalcard__t" }, r.t),
            h("div", { className: "portalcard__d" }, r.d),
            h("div", { className: "portalcard__cta" }, "Enter ", r.t.toLowerCase(), " portal ", h(Icon, { name: "chevR", size: 15 })))))),
);
  }

  // ---- Role-specific sign-in (real Supabase auth) ----
  function Login({ role, onLogin, onBack }) {
    const r = ROLES.find(x => x.id === role);
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const handleSubmit = async () => {
      setError(""); setLoading(true);
      try {
        const profile = await window.API.signIn(email, password);
        if (profile) {
          // Verify the role matches what they chose
          if (profile.role !== role) {
            setError(`This account has the '${profile.role}' role. Please use the ${profile.role} portal.`);
            await window.API.signOut();
            return;
          }
          window.API.setSavedRole(profile.role);
          onLogin(profile.role, profile);
        }
      } catch (e) {
        setError(e.message || "Sign-in failed");
      } finally {
        setLoading(false);
      }
    };

    return h("div", { className: "login" },
      h("div", { className: "login__aside" },
        h("div", { className: "login__asideGrid" }),
        h("div", { className: "login__brand" },
          h("div", { style: { width: 38, height: 38, borderRadius: 10, background: "rgba(255,255,255,0.15)", display: "grid", placeItems: "center" } },
            h(Icon, { name: "brain", size: 22 })),
          h("div", { style: { fontWeight: 600, fontSize: 17 } }, "BrainTumor AI")),
        h("div", { className: "login__headline" },
          h("h1", null, "Clarity in every scan."),
          h("p", null, "AI-assisted tumor segmentation, 3D visualization, and a shared record connecting your imaging team, clinicians, and patients."),
),
      ),
      h("div", { className: "login__main" },
        h("div", { className: "login__card" },
          h("button", { className: "login__back", onClick: onBack }, h(Icon, { name: "chevL", size: 15 }), "All portals"),
          h("div", { className: "login__rolehead" },
            h("div", { className: "ic" }, h(Icon, { name: r.icon, size: 22 })),
            h("div", null,
              h("h2", { style: { margin: 0 } }, r.t, " sign-in"),
              h("div", { className: "muted", style: { fontSize: 13 } }, "BrainTumor AI platform"))),
          error && h("div", { style: { background: "var(--risk-bg)", color: "var(--risk)", border: "1px solid var(--risk-line)", borderRadius: "var(--radius-sm)", padding: "10px 14px", fontSize: 13, marginBottom: 8 } }, error),
          h("div", { className: "field" },
            h("label", null, "Email"),
            h("input", { className: "input", type: "email", value: email, onChange: e => setEmail(e.target.value) })),
          h("div", { className: "field" },
            h("label", null, "Password"),
            h("input", { className: "input", type: "password", value: password, onChange: e => setPassword(e.target.value),
              onKeyDown: e => e.key === "Enter" && handleSubmit() })),
          h("button", {
            className: "btn btn--primary btn--block btn--lg",
            style: { marginTop: 10 },
            disabled: loading || !email || !password,
            onClick: handleSubmit,
          }, loading ? "Signing in…" : h(React.Fragment, null, "Sign in as ", r.t, h(Icon, { name: "chevR", size: 16 }))),
          h("div", { style: { textAlign: "center", marginTop: 18, fontSize: 12.5, color: "var(--ink-3)" } },
            h(Icon, { name: "shield", size: 13, style: { verticalAlign: "-2px", marginRight: 4 } }),
            "Protected health information · end-to-end encrypted"))));
  }

  // ---- Root App ----
  function App() {
    const [session, setSession] = useState(null);   // { role, profile }
    const [picked, setPicked] = useState(null);

    useEffect(() => {
      const savedRole = window.API.getSavedRole();
      if (savedRole && window.API.getToken()) {
        // Restore session — fetch fresh profile to validate token
        fetch("/api/me", { headers: { Authorization: "Bearer " + window.API.getToken() } })
          .then(r => r.ok ? r.json() : null)
          .then(profile => {
            if (profile) setSession({ role: profile.role, profile });
            else { window.API.signOut(); }
          })
          .catch(() => window.API.signOut());
      }
    }, []);

    const login = (role, profile) => setSession({ role, profile });
    const logout = async () => { await window.API.signOut(); setSession(null); setPicked(null); };
    const switchRole = (_role) => {
      // Role switching disabled — each user is locked to their assigned role.
    };

    if (!session) {
      if (!picked) return h(Landing, { onPick: setPicked });
      return h(Login, { role: picked, onLogin: login, onBack: () => setPicked(null) });
    }

    if (session.role === "admin")   return h(window.AdminApp,   { onRole: switchRole, onLogout: logout, user: session.profile });
    if (session.role === "patient") return h(window.PatientApp, { onRole: switchRole, onLogout: logout, user: session.profile });
    return h(window.DoctorApp, { onRole: switchRole, onLogout: logout, user: session.profile });
  }

  ReactDOM.createRoot(document.getElementById("root")).render(h(App));
})();
