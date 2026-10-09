const installed = new WeakSet();
const finite = value => value && Number.isFinite(value.x) && Number.isFinite(value.y);

function requiredSize(render, x, y, sz = render.sz) {
  const { clientArea: area, options } = render, zoom = options.zoom;
  if (!finite(sz) || ![x, y, zoom, area.clientWidth, area.clientHeight].every(Number.isFinite) || zoom <= 0)
    throw new Error("Ketcher view bounds are invalid");
  const Point = sz.constructor;
  const size = new Point(Math.max(sz.x, Math.ceil((Math.ceil(Math.max(0, x)) + area.clientWidth) / zoom)),
    Math.max(sz.y, Math.ceil((Math.ceil(Math.max(0, y)) + area.clientHeight) / zoom)));
  if (!finite(size)) throw new Error("Ketcher view bounds are invalid");
  return size;
}

// Preserve the visible CSS viewport when the legacy native paper planner crops/rebases.
export function installKetcherPaperExtent(editor) {
  const render = editor.render;
  if (installed.has(render)) return;
  if (typeof render?.setPaperSize !== "function" || typeof render.setOffset !== "function" || !finite(render.sz))
    throw new Error("Ketcher camera API is unavailable");
  const setPaperSize = render.setPaperSize, setOffset = render.setOffset;
  const zoom = editor.zoom;
  let zooming = false;
  // Native zoom owns its synchronous anchor/crop transaction, not an ordinary hand rebase.
  editor.zoom = function(...args) {
    if (!args.length) return zoom.apply(this, args);
    const previous = zooming; zooming = true;
    try { return zoom.apply(this, args); }
    finally { zooming = previous; }
  };
  render.setPaperSize = function(size) {
    if (!finite(size)) throw new Error("Ketcher view bounds are invalid");
    if (zooming) return setPaperSize.call(this, size);
    const minimum = requiredSize(this, this.clientArea.scrollLeft, this.clientArea.scrollTop, size);
    return setPaperSize.call(this, minimum);
  };
  render.setOffset = function(offset) {
    if (!finite(offset) || !finite(this.options.offset)) throw new Error("Ketcher view bounds are invalid");
    if (!zooming) {
      const x = this.clientArea.scrollLeft + (offset.x - this.options.offset.x) * this.options.zoom;
      const y = this.clientArea.scrollTop + (offset.y - this.options.offset.y) * this.options.zoom;
      const size = requiredSize(this, x, y);
      if (size.x > this.sz.x || size.y > this.sz.y) this.setPaperSize(size);
    }
    return setOffset.call(this, offset);
  };
  installed.add(render);
}
