const installed = new WeakMap();

function moveScroll(area, key, delta, state) {
  const position = area[key], target = position + delta + (position === state.position ? state.remainder : 0);
  area[key] = target;
  const actual = area[key], remainder = target - actual;
  const limit = key === "scrollLeft" ? area.scrollWidth - area.clientWidth : area.scrollHeight - area.clientHeight;
  const clamped = target < 0 || Number.isFinite(limit) && target > Math.max(0, limit);
  state.position = actual;
  // Preserve subpixel rounding, but never accumulate a clamped viewport movement.
  state.remainder = !clamped && Math.abs(remainder) < 1 ? remainder : 0;
}

export function resetKetcherScrollCoordinates(render) {
  installed.get(render)?.();
}

// Bundled Ketcher 2.13 offsets are SVG paper units; DOM scrolling uses CSS pixels.
export function installKetcherScrollCoordinates(render) {
  if (installed.has(render)) { resetKetcherScrollCoordinates(render); return; }
  if (typeof render?.setOffset !== "function" || typeof render.setZoom !== "function"
    || typeof render.clientArea?.addEventListener !== "function" || !render.options)
    throw new Error("Ketcher camera API is unavailable");
  const axes = [{}, {}];
  let previousZoom;
  const reset = () => { for (const state of axes) { state.position = undefined; state.remainder = 0; } };
  const setZoom = render.setZoom;
  render.setZoom = function(...args) { reset(); return setZoom.apply(this, args); };
  const area = render.clientArea;
  for (const event of ["pointerdown", "wheel", "keydown"]) area.addEventListener(event, reset, { passive: true });
  area.addEventListener("scroll", () => {
    if (area.scrollLeft !== axes[0].position || area.scrollTop !== axes[1].position) reset();
  }, { passive: true });
  render.setOffset = function(offset) {
    const current = this.options.offset, zoom = this.options.zoom;
    if (![offset?.x, offset?.y, current?.x, current?.y, zoom].every(Number.isFinite) || zoom <= 0)
      throw new Error("Ketcher view bounds are invalid");
    const delta = [(offset.x - current.x) * zoom, (offset.y - current.y) * zoom];
    if (!delta.every(Number.isFinite)) throw new Error("Ketcher view bounds are invalid");
    if (zoom !== previousZoom) reset();
    moveScroll(this.clientArea, "scrollLeft", delta[0], axes[0]);
    moveScroll(this.clientArea, "scrollTop", delta[1], axes[1]);
    previousZoom = zoom;
    this.options.offset = offset;
  };
  installed.set(render, reset);
}
