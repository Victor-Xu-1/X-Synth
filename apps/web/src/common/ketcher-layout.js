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
  editor.zoomAccordingContent(molecule);
  // Refresh the camera at its current zoom without moving molecular coordinates.
  editor.zoom(editor.zoom());
  return true;
}
