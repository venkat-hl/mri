/* ============================================================
   MRI Viewer — procedural brain slice renderer + annotation
   window.MRIViewer
   ============================================================ */
(function () {
  const { useRef, useEffect, useState, useCallback } = React;

  // deterministic PRNG
  function rng(seed) {
    let s = seed % 2147483647; if (s <= 0) s += 2147483646;
    return () => (s = (s * 16807) % 2147483647) / 2147483647;
  }

  // Draw a brain slice into ctx (logical W×H). plane: axial|sagittal|coronal
  function drawSlice(ctx, W, H, opts) {
    const { slice = 88, total = 176, plane = "axial", overlay = true, contrast = 1 } = opts;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2;
    // how "central" the slice is (1 at middle, →0 at ends)
    const t = 1 - Math.abs(slice - total / 2) / (total / 2); // 0..1
    const central = Math.max(0.12, t);
    const rx = (plane === "sagittal" ? 0.40 : 0.40) * W * (0.55 + 0.45 * central);
    const ry = (plane === "axial" ? 0.34 : 0.42) * H * (0.55 + 0.45 * central);
    const r = rng(Math.floor(slice) * 97 + (plane === "axial" ? 1 : plane === "sagittal" ? 2 : 3));

    // skull (bone ring)
    ctx.save();
    ctx.translate(cx, cy);
    if (plane === "sagittal") ctx.rotate(0);
    const skull = (k) => { ctx.beginPath(); ctx.ellipse(0, 0, rx * k, ry * k, 0, 0, Math.PI * 2); };
    skull(1.09); ctx.fillStyle = "oklch(0.62 0.01 250)"; ctx.fill();
    skull(1.02); ctx.fillStyle = "oklch(0.30 0.01 250)"; ctx.fill(); // CSF/space
    // parenchyma gradient
    skull(1.0);
    const g = ctx.createRadialGradient(-rx * 0.2, -ry * 0.25, rx * 0.1, 0, 0, rx * 1.05);
    const base = 0.40 + 0.10 * contrast;
    g.addColorStop(0, `oklch(${base + 0.18} 0.005 250)`);
    g.addColorStop(0.7, `oklch(${base} 0.005 250)`);
    g.addColorStop(1, `oklch(${base - 0.12} 0.005 250)`);
    ctx.fillStyle = g; ctx.fill();
    ctx.clip();

    // gyri / sulci texture — wandering darker strokes
    ctx.lineCap = "round";
    const folds = plane === "axial" ? 46 : 38;
    for (let i = 0; i < folds; i++) {
      const a0 = r() * Math.PI * 2;
      const rad = (0.25 + r() * 0.78) * rx;
      const px = Math.cos(a0) * rad, py = Math.sin(a0) * rad * (ry / rx);
      ctx.beginPath();
      ctx.moveTo(px, py);
      let x = px, y = py, ang = r() * Math.PI * 2;
      const seg = 3 + Math.floor(r() * 4);
      for (let j = 0; j < seg; j++) {
        ang += (r() - 0.5) * 1.6;
        const len = 6 + r() * 16;
        x += Math.cos(ang) * len; y += Math.sin(ang) * len;
        ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `oklch(${0.26 + r() * 0.08} 0.006 250 / ${0.5 + r() * 0.4})`;
      ctx.lineWidth = 1 + r() * 2.4;
      ctx.stroke();
    }
    // subtle speckle for grain
    for (let i = 0; i < 240; i++) {
      const a = r() * Math.PI * 2, rr = r() * rx;
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr * (ry / rx);
      ctx.fillStyle = `oklch(${0.45 + r() * 0.2} 0.005 250 / 0.18)`;
      ctx.fillRect(x, y, 1.4, 1.4);
    }

    // ventricles (dark CSF) — only near central slices
    if (central > 0.45) {
      ctx.fillStyle = "oklch(0.20 0.01 250)";
      const vh = ry * 0.34 * central;
      const drawVent = (sx) => {
        ctx.beginPath();
        ctx.moveTo(sx * rx * 0.06, -vh);
        ctx.quadraticCurveTo(sx * rx * 0.30, -vh * 0.3, sx * rx * 0.20, vh);
        ctx.quadraticCurveTo(sx * rx * 0.10, vh * 0.5, sx * rx * 0.05, vh * 0.2);
        ctx.closePath(); ctx.fill();
      };
      drawVent(1); drawVent(-1);
    }
    // falx / midline
    if (plane !== "sagittal") {
      ctx.strokeStyle = "oklch(0.30 0.01 250 / 0.8)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, -ry * 0.92); ctx.lineTo(0, ry * 0.92); ctx.stroke();
    }

    // ---- TUMOR (right temporal → appears lower-left, radiological flip) ----
    // present on central slices
    const tumorVis = central > 0.38;
    if (tumorVis) {
      const tcx = plane === "sagittal" ? rx * 0.18 : -rx * 0.42;
      const tcy = plane === "axial" ? ry * 0.30 : ry * 0.34;
      const tr = (0.16 + 0.10 * central) * rx;
      // vasogenic edema halo
      const eg = ctx.createRadialGradient(tcx, tcy, tr * 0.6, tcx, tcy, tr * 2.1);
      eg.addColorStop(0, "oklch(0.55 0.01 250 / 0)");
      eg.addColorStop(1, "oklch(0.62 0.01 250 / 0.55)");
      ctx.fillStyle = eg;
      ctx.beginPath(); ctx.ellipse(tcx, tcy, tr * 2.1, tr * 1.8, 0.3, 0, Math.PI * 2); ctx.fill();
      // necrotic ring-enhancing mass (irregular blob)
      ctx.beginPath();
      const pts = 16;
      for (let i = 0; i <= pts; i++) {
        const a = (i / pts) * Math.PI * 2;
        const wob = tr * (0.78 + 0.30 * r());
        const x = tcx + Math.cos(a) * wob, y = tcy + Math.sin(a) * wob * 0.9;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = "oklch(0.70 0.01 250)"; ctx.fill();     // bright enhancing
      // central necrosis
      ctx.beginPath(); ctx.ellipse(tcx + tr * 0.1, tcy, tr * 0.45, tr * 0.4, 0.4, 0, Math.PI * 2);
      ctx.fillStyle = "oklch(0.34 0.01 250)"; ctx.fill();

      if (overlay) {
        // AI segmentation overlay
        ctx.beginPath();
        for (let i = 0; i <= pts; i++) {
          const a = (i / pts) * Math.PI * 2;
          const wob = tr * (0.86 + 0.28 * rng(i + 7)());
          const x = tcx + Math.cos(a) * wob, y = tcy + Math.sin(a) * wob * 0.9;
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = "oklch(0.62 0.20 25 / 0.34)";
        ctx.fill();
        ctx.strokeStyle = "oklch(0.66 0.21 25)"; ctx.lineWidth = 2; ctx.stroke();
        // edema overlay (teal)
        ctx.beginPath(); ctx.ellipse(tcx, tcy, tr * 1.9, tr * 1.6, 0.3, 0, Math.PI * 2);
        ctx.strokeStyle = "oklch(0.70 0.12 195 / 0.55)"; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
        ctx.stroke(); ctx.setLineDash([]);
      }
    }
    ctx.restore();
    return { tumorVis };
  }

  // 3D pseudo-render of brain volume with tumor
  function draw3D(ctx, W, H, overlay) {
    ctx.clearRect(0, 0, W, H); ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2;
    const g = ctx.createRadialGradient(cx - W * 0.16, cy - H * 0.2, W * 0.05, cx, cy, W * 0.5);
    g.addColorStop(0, "oklch(0.80 0.02 250)");
    g.addColorStop(0.55, "oklch(0.62 0.02 250)");
    g.addColorStop(1, "oklch(0.34 0.02 250)");
    ctx.save(); ctx.translate(cx, cy);
    ctx.beginPath(); ctx.ellipse(0, 0, W * 0.34, H * 0.30, 0, 0, Math.PI * 2);
    ctx.fillStyle = g; ctx.fill();
    ctx.clip();
    // surface gyri ridges
    const r = rng(42);
    for (let i = 0; i < 80; i++) {
      ctx.beginPath();
      const y = -H * 0.3 + r() * H * 0.6;
      ctx.moveTo(-W * 0.34, y);
      let x = -W * 0.34, yy = y;
      for (let j = 0; j < 8; j++) { x += W * 0.09; yy += (r() - 0.5) * 14; ctx.lineTo(x, yy); }
      ctx.strokeStyle = `oklch(${0.4 + r() * 0.25} 0.02 250 / 0.4)`; ctx.lineWidth = 1 + r() * 1.5; ctx.stroke();
    }
    // tumor glowing
    const tx = -W * 0.13, ty = H * 0.08;
    const tg = ctx.createRadialGradient(tx, ty, 2, tx, ty, W * 0.13);
    tg.addColorStop(0, overlay ? "oklch(0.70 0.22 25)" : "oklch(0.78 0.02 250)");
    tg.addColorStop(1, overlay ? "oklch(0.55 0.20 25 / 0.1)" : "oklch(0.5 0.02 250 / 0.1)");
    ctx.beginPath(); ctx.ellipse(tx, ty, W * 0.12, H * 0.11, 0.3, 0, Math.PI * 2);
    ctx.fillStyle = tg; ctx.fill();
    if (overlay) { ctx.strokeStyle = "oklch(0.7 0.21 25)"; ctx.lineWidth = 2; ctx.stroke(); }
    ctx.restore();
    // shadow
    ctx.beginPath(); ctx.ellipse(cx, cy + H * 0.34, W * 0.22, H * 0.04, 0, 0, Math.PI * 2);
    ctx.fillStyle = "oklch(0.1 0.02 250 / 0.5)"; ctx.fill();
  }

  // ---- Annotation overlay (imperative canvas) ----
  function AnnotationLayer({ tool, color, clearTick, enabled }) {
    const ref = useRef(null);
    const shapes = useRef([]);
    const draft = useRef(null);

    const redraw = useCallback(() => {
      const cv = ref.current; if (!cv) return;
      const ctx = cv.getContext("2d");
      ctx.clearRect(0, 0, cv.width, cv.height);
      const all = draft.current ? shapes.current.concat([draft.current]) : shapes.current;
      for (const s of all) {
        ctx.strokeStyle = s.color; ctx.fillStyle = s.color; ctx.lineWidth = 2.5;
        ctx.lineCap = "round"; ctx.lineJoin = "round";
        if (s.kind === "pen") {
          ctx.beginPath(); s.pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke();
        } else if (s.kind === "rect") {
          ctx.strokeRect(s.x0, s.y0, s.x1 - s.x0, s.y1 - s.y0);
        } else if (s.kind === "arrow") {
          const a = Math.atan2(s.y1 - s.y0, s.x1 - s.x0);
          ctx.beginPath(); ctx.moveTo(s.x0, s.y0); ctx.lineTo(s.x1, s.y1); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(s.x1, s.y1);
          ctx.lineTo(s.x1 - 12 * Math.cos(a - 0.4), s.y1 - 12 * Math.sin(a - 0.4));
          ctx.lineTo(s.x1 - 12 * Math.cos(a + 0.4), s.y1 - 12 * Math.sin(a + 0.4));
          ctx.closePath(); ctx.fill();
        } else if (s.kind === "ruler") {
          ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(s.x0, s.y0); ctx.lineTo(s.x1, s.y1); ctx.stroke(); ctx.setLineDash([]);
          const d = Math.hypot(s.x1 - s.x0, s.y1 - s.y0) * 0.12; // px→mm-ish
          const mx = (s.x0 + s.x1) / 2, my = (s.y0 + s.y1) / 2;
          ctx.font = "12px 'IBM Plex Mono', monospace"; const label = d.toFixed(1) + " mm";
          const tw = ctx.measureText(label).width;
          ctx.fillStyle = "oklch(0.2 0.02 250 / 0.85)"; ctx.fillRect(mx - tw / 2 - 5, my - 18, tw + 10, 16);
          ctx.fillStyle = "#fff"; ctx.fillText(label, mx - tw / 2, my - 6);
        } else if (s.kind === "text") {
          ctx.font = "600 14px 'IBM Plex Sans', sans-serif";
          const tw = ctx.measureText(s.text).width;
          ctx.fillStyle = "oklch(0.2 0.02 250 / 0.8)"; ctx.fillRect(s.x0 - 5, s.y0 - 14, tw + 10, 20);
          ctx.fillStyle = s.color; ctx.fillText(s.text, s.x0, s.y0);
        }
      }
    }, []);

    useEffect(() => { redraw(); }, [clearTick]);
    useEffect(() => { if (clearTick) { shapes.current = []; draft.current = null; redraw(); } }, [clearTick]);

    // size canvas to displayed size
    useEffect(() => {
      const cv = ref.current; if (!cv) return;
      const fit = () => {
        const rect = cv.getBoundingClientRect();
        cv.width = rect.width; cv.height = rect.height; redraw();
      };
      fit();
      const ro = new ResizeObserver(fit); ro.observe(cv);
      return () => ro.disconnect();
    }, [redraw]);

    const pos = (e) => {
      const rect = ref.current.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const onDown = (e) => {
      if (!enabled || tool === "cursor") return;
      e.currentTarget.setPointerCapture(e.pointerId);
      const p = pos(e);
      if (tool === "text") {
        const text = window.prompt("Annotation label:", "");
        if (text) { shapes.current.push({ kind: "text", x0: p.x, y0: p.y, text, color }); redraw(); }
        return;
      }
      if (tool === "eraser") { shapes.current.pop(); redraw(); return; }
      if (tool === "pen") draft.current = { kind: "pen", pts: [p], color };
      else draft.current = { kind: tool, x0: p.x, y0: p.y, x1: p.x, y1: p.y, color };
      redraw();
    };
    const onMove = (e) => {
      if (!draft.current) return;
      const p = pos(e);
      if (draft.current.kind === "pen") draft.current.pts.push(p);
      else { draft.current.x1 = p.x; draft.current.y1 = p.y; }
      redraw();
    };
    const onUp = () => { if (draft.current) { shapes.current.push(draft.current); draft.current = null; redraw(); } };

    return React.createElement("canvas", {
      ref, className: "annot-canvas",
      style: { cursor: enabled && tool !== "cursor" ? "crosshair" : "default", pointerEvents: enabled && tool !== "cursor" ? "auto" : "none" },
      onPointerDown: onDown, onPointerMove: onMove, onPointerUp: onUp, onPointerLeave: onUp,
    });
  }

  const TOOLS = [
    { id: "cursor", icon: "cursor", label: "Pan / select" },
    { id: "pen", icon: "pen", label: "Freehand" },
    { id: "rect", icon: "square", label: "Rectangle" },
    { id: "arrow", icon: "arrowUR", label: "Arrow" },
    { id: "ruler", icon: "ruler", label: "Measure" },
    { id: "text", icon: "type", label: "Text note" },
  ];
  const SWATCHES = ["oklch(0.66 0.21 25)", "oklch(0.74 0.16 95)", "oklch(0.65 0.16 145)", "oklch(0.7 0.13 250)", "oklch(0.99 0 0)"];

  function MRIViewer({ scan, mode = "readonly" }) {
    const [tab, setTab] = useState("2d");
    const [slice, setSlice] = useState(88);
    const [overlay, setOverlay] = useState(true);
    const [contrast, setContrast] = useState(1);
    const [tool, setTool] = useState("cursor");
    const [color, setColor] = useState(SWATCHES[0]);
    const [clearTick, setClearTick] = useState(0);
    const mainRef = useRef(null);
    const mprRefs = [useRef(null), useRef(null), useRef(null), useRef(null)];

    const total = scan.slices || 176;

    // render main 2D
    useEffect(() => {
      const cv = mainRef.current; if (!cv || tab !== "2d") return;
      const ctx = cv.getContext("2d");
      drawSlice(ctx, cv.width, cv.height, { slice, total, plane: "axial", overlay, contrast });
    }, [tab, slice, overlay, contrast, total]);

    // render multiplanar
    useEffect(() => {
      if (tab !== "3d") return;
      const planes = ["axial", "sagittal", "coronal"];
      planes.forEach((pl, i) => {
        const cv = mprRefs[i].current; if (!cv) return;
        drawSlice(cv.getContext("2d"), cv.width, cv.height, { slice, total, plane: pl, overlay, contrast });
      });
      const cv3 = mprRefs[3].current; if (cv3) draw3D(cv3.getContext("2d"), cv3.width, cv3.height, overlay);
    }, [tab, slice, overlay, contrast, total]);

    const h = (...a) => React.createElement(...a);
    const Icon = window.Icon;

    return h("div", { className: "viewer" },
      // top bar
      h("div", { className: "viewer__bar" },
        h("div", { className: "viewer__tabs" },
          h("button", { "aria-pressed": tab === "2d", onClick: () => setTab("2d") }, "2D Slices"),
          h("button", { "aria-pressed": tab === "3d", onClick: () => setTab("3d") }, "3D · Multiplanar"),
        ),
        h("div", { className: "right" },
          h("button", { className: "vbtn", "aria-pressed": overlay, onClick: () => setOverlay(o => !o) },
            h(Icon, { name: overlay ? "eye" : "eyeOff", size: 14 }), "AI overlay"),
          h("button", { className: "vbtn", "aria-pressed": contrast > 1, onClick: () => setContrast(c => c > 1 ? 1 : 1.4) },
            h(Icon, { name: "contrast", size: 14 }), "Window"),
          mode === "doctor" && h("button", { className: "vbtn", onClick: () => setClearTick(t => t + 1) },
            h(Icon, { name: "trash", size: 14 }), "Clear"),
        ),
      ),
      // stage
      tab === "2d"
        ? h("div", { className: "viewer__stage" },
            h("div", { className: "viewer__canvaswrap", style: { aspectRatio: "1 / 0.82" } },
              h("canvas", { ref: mainRef, width: 760, height: 624 }),
              h(AnnotationLayer, { tool, color, clearTick, enabled: mode === "doctor" }),
              h("div", { className: "viewer__hud" },
                h("div", null, scan.sequence || "T1 MPRAGE"),
                h("div", null, "Slice ", Math.round(slice), " / ", total),
                h("div", null, scan.voxel),
              ),
              h("div", { className: "orient", style: { top: "8px", left: "50%", transform: "translateX(-50%)" } }, "A"),
              h("div", { className: "orient", style: { bottom: "8px", left: "50%", transform: "translateX(-50%)" } }, "P"),
              h("div", { className: "orient", style: { top: "50%", left: "8px", transform: "translateY(-50%)" } }, "R"),
              h("div", { className: "orient", style: { top: "50%", right: "8px", transform: "translateY(-50%)" } }, "L"),
            ),
            mode === "doctor" && h(Toolbar, { tool, setTool, color, setColor }),
          )
        : h("div", { className: "viewer__stage" },
            h("div", { className: "mpr" },
              ["Axial", "Sagittal", "Coronal"].map((lbl, i) =>
                h("div", { className: "mpr__cell", key: lbl, style: { aspectRatio: "1 / 0.78" } },
                  h("canvas", { ref: mprRefs[i], width: 380, height: 296, style: { width: "100%", height: "auto", display: "block" } }),
                  h("span", { className: "lbl" }, lbl))),
              h("div", { className: "mpr__cell", style: { aspectRatio: "1 / 0.78" } },
                h("canvas", { ref: mprRefs[3], width: 380, height: 296, style: { width: "100%", height: "auto", display: "block" } }),
                h("span", { className: "lbl" }, "3D render"),
                h("button", { className: "vbtn", style: { position: "absolute", bottom: 8, right: 8 } },
                  h(Icon, { name: "rotate", size: 13 }), "Rotate")),
            ),
          ),
      // slice control
      h("div", { className: "slice-ctrl" },
        h(Icon, { name: "layers", size: 15 }),
        h("span", { className: "lab" }, "Slice"),
        h("input", { type: "range", className: "slider", min: 1, max: total, value: Math.round(slice),
          onChange: e => setSlice(+e.target.value) }),
        h("span", { className: "lab", style: { minWidth: 58, textAlign: "right" } }, Math.round(slice), " / ", total),
      ),
    );
  }

  function Toolbar({ tool, setTool, color, setColor }) {
    const h = (...a) => React.createElement(...a);
    const Icon = window.Icon;
    return h("div", { className: "tools" },
      TOOLS.map(t => h("button", { key: t.id, className: "tool", title: t.label, "aria-pressed": tool === t.id, onClick: () => setTool(t.id) },
        h(Icon, { name: t.icon, size: 17 }))),
      h("div", { className: "tools__div" }),
      h("div", { className: "tools__swatches" },
        SWATCHES.map(c => h("button", { key: c, className: "swatch", "aria-pressed": color === c, style: { background: c }, onClick: () => setColor(c) }))),
    );
  }

  window.MRIViewer = MRIViewer;
})();
