export function prepareKetcherDocument(doc) {
  if (!doc?.head || doc.getElementById("x-synth-ketcher-responsive-style"))
    return;
  const style = doc.createElement("style");
  style.id = "x-synth-ketcher-responsive-style";
  style.textContent = `
    html, body { width: 100% !important; height: 100% !important; margin: 0 !important; overflow: hidden !important; }
    .Ketcher-root, body > div[role="application"], body main[role="application"] {
      width: 100% !important; height: 100% !important; min-width: 0 !important; min-height: 0 !important;
    }
    [class*="App-module_canvas"] { min-width: 0 !important; min-height: 0 !important; }
  `;
  doc.head.appendChild(style);
}

// The bundled Ketcher 2.13 editor keeps its scroll origin across iframe resizes.
export function fitKetcherCanvas(editor) {
  if (!editor?.struct || !editor?.zoom || !editor?.zoomAccordingContent)
    return false;
  const molecule = editor.struct();
  if (!molecule?.atoms?.size) return false;
  if (
    typeof editor.selection !== "function" ||
    typeof editor.event?.selectionChange?.dispatch !== "function"
  )
    throw new Error("Ketcher view update events are unavailable");
  // Native fitting only shrinks; a prior narrow view must not constrain the new fit.
  if (editor.zoom() !== 1) editor.zoom(1);
  editor.zoomAccordingContent(molecule);
  const viewport = editor.render?.clientArea?.getBoundingClientRect?.();
  const bounds = molecule.getCoordBoundingBox?.();
  const scale = editor.render?.options?.scale;
  let zoom = editor.zoom();
  if (viewport && bounds && Number.isFinite(scale) && scale > 0) {
    const width = (bounds.max.x - bounds.min.x) * scale;
    const height = (bounds.max.y - bounds.min.y) * scale;
    // Ketcher 2.13's native fit omits its label margin when the skeleton just fits.
    const fitted = Math.min(
      zoom,
      width > 0 ? Math.max(1, viewport.width - 64) / width : zoom,
      height > 0 ? Math.max(1, viewport.height - 64) / height : zoom,
    );
    if (Number.isFinite(fitted) && fitted > 0)
      zoom = fitted >= 0.01 ? Math.floor(fitted * 100) / 100 : fitted;
  }
  // Refresh the camera at its current zoom without moving molecular coordinates.
  editor.zoom(zoom);
  // The native toolbar observes view events, not direct camera changes.
  editor.event.selectionChange.dispatch(editor.selection());
  return true;
}
