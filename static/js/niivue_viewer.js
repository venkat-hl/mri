/* ============================================================
   NiiVueViewer — WebGL 3D NIfTI viewer using NiiVue library
   Props: niiUrl (string), mode ("3d" | "multiplanar")
   ============================================================ */
(function () {
  const { useEffect, useRef, useState } = React;
  const h = (...a) => React.createElement(...a);

  function NiiVueViewer({ niiUrl, mode = "3d" }) {
    const canvasRef = useRef(null);
    const containerRef = useRef(null);
    const nvRef = useRef(null);
    const [status, setStatus] = useState("loading");
    const [viewMode, setViewMode] = useState(mode);
    const [isFullscreen, setIsFullscreen] = useState(false);

    useEffect(() => {
      const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
      document.addEventListener("fullscreenchange", onFsChange);
      return () => document.removeEventListener("fullscreenchange", onFsChange);
    }, []);

    const toggleFullscreen = () => {
      if (!document.fullscreenElement) {
        containerRef.current && containerRef.current.requestFullscreen();
      } else {
        document.exitFullscreen();
      }
    };

    useEffect(() => {
      if (!niiUrl || !canvasRef.current) return;
      const NiivueClass = (window.niivue && window.niivue.Niivue) || window.Niivue;
      if (!NiivueClass) {
        setStatus("error: NiiVue library not loaded");
        return;
      }

      let cancelled = false;
      const nv = new NiivueClass({
        backColor: [0, 0, 0, 1],
        show3Dcrosshair: false,
        isColorbar: false,
        isOrientCube: true,
      });
      nvRef.current = nv;

      nv.attachToCanvas(canvasRef.current).then(() => {
        if (cancelled) return;
        return nv.loadVolumes([{ url: niiUrl, colorMap: "gray", opacity: 1 }]);
      }).then(() => {
        if (cancelled) return;
        applyViewMode(nv, viewMode);
        setStatus("ready");
      }).catch(err => {
        if (!cancelled) setStatus("error: " + (err.message || String(err)));
      });

      return () => { cancelled = true; };
    }, [niiUrl]);

    useEffect(() => {
      if (nvRef.current && status === "ready") {
        applyViewMode(nvRef.current, viewMode);
      }
    }, [viewMode]);

    function applyViewMode(nv, vm) {
      if (vm === "3d") {
        nv.setSliceType(nv.sliceTypeRender);
      } else {
        nv.setSliceType(nv.sliceTypeMultiplanar);
      }
    }

    const btnStyle = (active) => ({
      fontSize: 12, padding: "3px 12px", borderRadius: 6, cursor: "pointer",
      border: "1px solid #444",
      background: active ? "var(--primary)" : "transparent",
      color: active ? "#fff" : "#aaa",
    });

    const fsBtn = {
      fontSize: 12, padding: "3px 10px", borderRadius: 6, cursor: "pointer",
      border: "1px solid #444", background: "transparent",
      color: isFullscreen ? "#fff" : "#aaa",
    };

    const containerStyle = isFullscreen
      ? { background: "#000", display: "flex", flexDirection: "column", width: "100%", height: "100%" }
      : { background: "#000", borderRadius: "var(--radius)", overflow: "hidden" };

    const canvasHeight = isFullscreen ? "calc(100vh - 80px)" : 600;

    return h("div", { ref: containerRef, style: containerStyle },
      // toolbar
      h("div", { style: { display: "flex", gap: 8, padding: "8px 14px", background: "rgba(255,255,255,0.05)", alignItems: "center", flexShrink: 0 } },
        h("span", { style: { color: "#888", fontSize: 12 } }, "3D MRI Viewer"),
        h("div", { style: { flex: 1 } }),
        h("button", { style: btnStyle(viewMode === "3d"), onClick: () => setViewMode("3d") }, "3D Volume"),
        h("button", { style: btnStyle(viewMode === "multiplanar"), onClick: () => setViewMode("multiplanar") }, "Multiplanar"),
        status === "loading" && h("span", { style: { color: "#555", fontSize: 11 } }, "Loading…"),
        status.startsWith("error") && h("span", { style: { color: "#f66", fontSize: 11 } }, status),
        h("button", { style: fsBtn, onClick: toggleFullscreen, title: isFullscreen ? "Exit fullscreen" : "Fullscreen" },
          isFullscreen ? "⛶ Exit" : "⛶ Fullscreen")),

      // canvas
      h("div", { style: { position: "relative", flex: 1 } },
        status === "loading" && h("div", {
          style: { position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#555", fontSize: 13, zIndex: 1 }
        }, "Rendering 3D volume…"),
        h("canvas", {
          ref: canvasRef,
          style: { width: "100%", height: canvasHeight, display: "block" }
        })),

      h("div", { style: { textAlign: "center", padding: "6px 0 10px", color: "#444", fontSize: 11, flexShrink: 0 } },
        "Left-drag to rotate · Right-drag to zoom · Scroll to slice through"));
  }

  window.NiiVueViewer = NiiVueViewer;
})();
