/* ============================================================
   RealMRIViewer — displays actual NIfTI slice PNGs from the backend
   Props: scan { id, slice_count, slice_base, modality }, mode
   ============================================================ */
(function () {
  const { useState, useEffect, useRef, useCallback } = React;
  const h = (...a) => React.createElement(...a);

  function RealMRIViewer({ scan, mode }) {
    const sliceCount = scan.slice_count || 0;
    const sliceBase = scan.slice_base || `/static/outputs/${scan.id}/`;
    const [idx, setIdx] = useState(Math.floor(sliceCount / 2));
    const [showOverlay, setShowOverlay] = useState(!!scan.has_overlay);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState(false);

    const sliceUrl = (i) => {
      const key = String(i).padStart(3, "0");
      return showOverlay
        ? `${sliceBase}overlay_${key}.png`
        : `${sliceBase}flair_${key}.png`;
    };

    useEffect(() => { setLoaded(false); setError(false); }, [idx, showOverlay]);

    if (sliceCount === 0) {
      return h("div", { className: "viewer" },
        h("div", { style: { display: "flex", alignItems: "center", justifyContent: "center", height: 400, flexDirection: "column", gap: 12, color: "var(--ink-3)" } },
          h("div", { style: { fontSize: 32 } }, "🧠"),
          h("div", { style: { fontWeight: 600 } }, "No slices available"),
          h("div", { style: { fontSize: 13 } }, "Upload a NIfTI scan to generate slice images.")));
    }

    return h("div", { className: "viewer", style: { background: "#000", borderRadius: "var(--radius)", overflow: "hidden" } },
      // toolbar
      h("div", { style: { display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", background: "rgba(255,255,255,0.05)" } },
        h("span", { style: { color: "#aaa", fontSize: 12, fontFamily: "var(--mono)" } }, "Slice ", idx + 1, " / ", sliceCount),
        h("div", { style: { flex: 1 } }),
        scan.has_overlay && h("button", {
          onClick: () => setShowOverlay(v => !v),
          style: { fontSize: 12, padding: "3px 10px", borderRadius: 6, border: "1px solid #444", background: showOverlay ? "var(--primary)" : "transparent", color: showOverlay ? "#fff" : "#aaa", cursor: "pointer" }
        }, showOverlay ? "Overlay ON" : "Overlay OFF"),
        h("span", { style: { color: "#555", fontSize: 11 } }, scan.modality || "MRI")),

      // slice image
      h("div", { style: { position: "relative", background: "#000", minHeight: 380, display: "flex", alignItems: "center", justifyContent: "center" } },
        !loaded && !error && h("div", { style: { position: "absolute", color: "#555", fontSize: 13 } }, "Loading slice…"),
        error && h("div", { style: { position: "absolute", color: "#555", fontSize: 13 } }, "Slice image not found"),
        h("img", {
          key: sliceUrl(idx),
          src: sliceUrl(idx),
          onLoad: () => setLoaded(true),
          onError: () => { setError(true); setLoaded(true); },
          style: { display: loaded && !error ? "block" : "none", maxWidth: "100%", maxHeight: 480, objectFit: "contain", imageRendering: "pixelated" }
        })),

      // slider
      h("div", { style: { padding: "10px 14px 14px" } },
        h("input", {
          type: "range", min: 0, max: sliceCount - 1, value: idx,
          onChange: e => setIdx(Number(e.target.value)),
          style: { width: "100%", accentColor: "var(--primary)", cursor: "pointer" }
        })),

      // keyboard hint
      h("div", { style: { textAlign: "center", paddingBottom: 8, color: "#444", fontSize: 11 } },
        "Drag slider · ", sliceCount, " axial slices"));
  }

  window.RealMRIViewer = RealMRIViewer;
})();
