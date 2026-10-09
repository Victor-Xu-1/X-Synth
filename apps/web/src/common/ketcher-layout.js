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

const finitePoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);

export function zoomKetcherCanvas(editor, factor) {
  if (typeof editor?.zoom !== "function" || typeof editor.selection !== "function"
    || typeof editor.event?.selectionChange?.dispatch !== "function")
    throw new Error("Ketcher camera API is unavailable");
  const current = editor.zoom();
  if (!Number.isFinite(factor) || factor <= 0 || !Number.isFinite(current) || current <= 0)
    throw new Error("Ketcher view bounds are invalid");
  editor.zoom(Math.min(4, current * factor));
  editor.event.selectionChange.dispatch(editor.selection());
}

function visualBounds(editor) {
  const render = editor.render, box = render.ctab.getVBoxObj();
  if (!finitePoint(box?.p0) || !finitePoint(box?.p1) || box.p1.x < box.p0.x || box.p1.y < box.p0.y)
    throw new Error("Ketcher view bounds are invalid");
  let left = box.p0.x, top = box.p0.y, right = box.p1.x, bottom = box.p1.y;
  const Point = render.options.offset.constructor, zoom = editor.zoom();
  if (!Number.isFinite(zoom) || zoom <= 0) throw new Error("Ketcher view bounds are invalid");
  // Native selection controls lie outside ctab; include their actual paper-space bounds.
  for (const key of ["boundingRect", "handle", "cross", "link"]) {
    const control = editor.rotateController[key];
    if (!control) continue;
    if (typeof control.getBBox !== "function") throw new Error("Ketcher camera API is unavailable");
    const bounds = control.getBBox();
    if (![bounds?.x, bounds?.y, bounds?.width, bounds?.height].every(Number.isFinite)
      || bounds.width < 0 || bounds.height < 0) throw new Error("Ketcher view bounds are invalid");
    const project = (x, y) => render.view2obj(new Point(
      x * zoom - render.clientArea.scrollLeft, y * zoom - render.clientArea.scrollTop));
    const a = project(bounds.x, bounds.y), b = project(bounds.x + bounds.width, bounds.y + bounds.height);
    if (!finitePoint(a) || !finitePoint(b)) throw new Error("Ketcher view bounds are invalid");
    left = Math.min(left, a.x, b.x); top = Math.min(top, a.y, b.y);
    right = Math.max(right, a.x, b.x); bottom = Math.max(bottom, a.y, b.y);
  }
  return { p0: new Point(left, top), p1: new Point(right, bottom) };
}

// The bundled Ketcher 2.13 camera is separate from molecular layout/centerStruct.
export function fitKetcherCanvas(editor) {
  if (typeof editor?.struct !== "function") return false;
  const molecule = editor.struct();
  if (!molecule?.atoms?.size) return false;
  const render = editor.render;
  if (
    typeof editor.zoom !== "function" ||
    typeof editor.selection !== "function" ||
    typeof editor.event?.selectionChange?.dispatch !== "function" ||
    typeof editor.rotateController?.rerender !== "function" ||
    typeof render?.ctab?.getVBoxObj !== "function" ||
    typeof render.ctab.translate !== "function" ||
    typeof render.obj2view !== "function" ||
    typeof render.view2obj !== "function" ||
    typeof render.setOffset !== "function" ||
    typeof render.setPaperSize !== "function" ||
    typeof render.clientArea?.getBoundingClientRect !== "function" ||
    typeof render.options?.offset?.add !== "function"
  )
    throw new Error("Ketcher camera API is unavailable");
  const viewport = render.clientArea.getBoundingClientRect();
  if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height)
    || viewport.width <= 0 || viewport.height <= 0) return false;
  // The complete visual box includes labels, arrows and annotations, not just atoms.
  const box = visualBounds(editor), scale = render.options.scale;
  if (!finitePoint(box?.p0) || !finitePoint(box?.p1) || !finitePoint(render.options.offset)
    || !Number.isFinite(scale) || scale <= 0 || box.p1.x < box.p0.x || box.p1.y < box.p0.y)
    throw new Error("Ketcher view bounds are invalid");
  const width = (box.p1.x - box.p0.x) * scale, height = (box.p1.y - box.p0.y) * scale;
  const margin = Math.min(12, viewport.width / 4, viewport.height / 4);
  const zoom = Math.min(1,
    width > 0 ? (viewport.width - 2 * margin) / width : 1,
    height > 0 ? (viewport.height - 2 * margin) / height : 1);
  editor.zoom(zoom);
  const currentBox = visualBounds(editor);
  const a = render.obj2view(currentBox.p0), b = render.obj2view(currentBox.p1);
  if (!finitePoint(a) || !finitePoint(b)) throw new Error("Ketcher view bounds are invalid");
  const Point = render.options.offset.constructor;
  const delta = new Point(
    (viewport.width / 2 - (a.x + b.x) / 2 - render.clientArea.scrollLeft) / zoom,
    (viewport.height / 2 - (a.y + b.y) / 2 - render.clientArea.scrollTop) / zoom);
  // Translate only cached visual elements; native atoms and the undo history stay intact.
  render.setPaperSize(new Point(viewport.width / zoom, viewport.height / zoom));
  render.ctab.translate(delta);
  render.setOffset(render.options.offset.add(delta));
  render.clientArea.scrollLeft = 0;
  render.clientArea.scrollTop = 0;
  editor.rotateController.rerender();
  // The native toolbar observes view events, not direct camera changes.
  editor.event.selectionChange.dispatch(editor.selection());
  return true;
}
