import { fitKetcherCanvas, prepareKetcherDocument, zoomKetcherCanvas } from "./ketcher-layout";

class Point {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  add(value) { return new Point(this.x + value.x, this.y + value.y); }
}

// Camera protocol isolation only; real Ketcher/RDKit identities need browser acceptance.
function camera({ width = 207, height = 402, box = [0, 0, 42, 38], zoom = .04 } = {}) {
  const selected = { atoms: [1, 2], bonds: [3] };
  const molecule = { atoms: { size: 181 }, coordinates: [[0, 0], [42, 38]] };
  const area = Object.assign(new EventTarget(), { scrollLeft: 39, scrollTop: 2, clientWidth: width, clientHeight: height,
    getBoundingClientRect: () => ({ width, height }) });
  const render = {
    sz: new Point(1000, 1000),
    options: { scale: 40, offset: new Point(-100, 250), get zoom() { return zoom; } }, clientArea: area,
    ctab: {
      getVBoxObj: jest.fn(() => ({ p0: new Point(box[0], box[1]), p1: new Point(box[2], box[3]) })),
      translate: jest.fn(),
    },
    obj2view: jest.fn(point => new Point(
      (point.x * 40 + render.options.offset.x) * zoom - area.scrollLeft,
      (point.y * 40 + render.options.offset.y) * zoom - area.scrollTop,
    )),
    view2obj: jest.fn(point => new Point(
      ((point.x + area.scrollLeft) / zoom - render.options.offset.x) / 40,
      ((point.y + area.scrollTop) / zoom - render.options.offset.y) / 40,
    )),
    setPaperSize: jest.fn(value => { render.sz = value; }),
    setZoom: value => { zoom = value; },
    setOffset: jest.fn(offset => { render.options.offset = offset; }),
  };
  const editor = {
    struct: () => molecule,
    zoom: jest.fn(value => value === undefined ? zoom : render.setZoom(value)),
    zoomAccordingContent: jest.fn(() => { zoom = .1; }),
    render, selection: () => selected,
    event: { selectionChange: { dispatch: jest.fn() }, change: { dispatch: jest.fn() } },
    rotateController: { rerender: jest.fn() },
  };
  return editor;
}

test("inline and modal editors share one responsive compatibility adapter", () => {
  prepareKetcherDocument(document); prepareKetcherDocument(document);
  expect(document.querySelectorAll("#x-synth-ketcher-responsive-style")).toHaveLength(1);
  expect(document.querySelector("#x-synth-ketcher-responsive-style").textContent).toContain(".Ketcher-root");
  document.querySelector("#x-synth-ketcher-responsive-style").remove();
});

test("the complete visual box is fitted once without native double-shrinking", () => {
  const editor = camera();
  expect(fitKetcherCanvas(editor)).toBe(true);
  expect(editor.zoom()).toBeCloseTo((207 - 24) / (42 * 40), 10);
  expect(editor.zoomAccordingContent).not.toHaveBeenCalled();
  expect(editor.render.ctab.getVBoxObj).toHaveBeenCalledWith();
});

test("fitted content is centered after an inherited scroll origin", () => {
  const editor = camera({ box: [-4, 3, 38, 41] });
  expect(fitKetcherCanvas(editor)).toBe(true);
  const { p0, p1 } = editor.render.ctab.getVBoxObj();
  const a = editor.render.obj2view(p0), b = editor.render.obj2view(p1);
  expect((a.x + b.x) / 2).toBeCloseTo(207 / 2, 8);
  expect((a.y + b.y) / 2).toBeCloseTo(402 / 2, 8);
  expect(editor.render.clientArea.scrollLeft).toBe(0);
  expect(editor.render.clientArea.scrollTop).toBe(0);
});

test("render translations preserve molecular coordinates and current selection", () => {
  const editor = camera();
  const chemistry = JSON.stringify(editor.struct()), selection = JSON.stringify(editor.selection());
  fitKetcherCanvas(editor);
  expect(JSON.stringify(editor.struct())).toBe(chemistry);
  expect(JSON.stringify(editor.selection())).toBe(selection);
  expect(editor.event.selectionChange.dispatch).toHaveBeenCalledWith(editor.selection());
  expect(editor.event.change.dispatch).not.toHaveBeenCalled();
  expect(editor.rotateController.rerender).toHaveBeenCalledTimes(1);
});

test("a widened canvas restores readable scale without inheriting the narrow fit", () => {
  const editor = camera({ width: 753, height: 582, box: [0, 0, 12, 5], zoom: .04 });
  fitKetcherCanvas(editor);
  expect(editor.zoom()).toBe(1);
});

test("height and annotations constrain fitting independently of the atom skeleton", () => {
  const editor = camera({ width: 689, height: 160, box: [0, 0, 12, 30] });
  fitKetcherCanvas(editor);
  expect(editor.zoom()).toBeCloseTo((160 - 24) / (30 * 40), 10);
});

test("a very large complete drawing may fit below one percent without rounding to zero", () => {
  const editor = camera({ width: 137, box: [0, 0, 500, 50] });
  fitKetcherCanvas(editor);
  expect(editor.zoom()).toBeGreaterThan(0);
  expect(editor.zoom()).toBeLessThan(.01);
  expect(editor.zoom() * 500 * 40).toBeLessThanOrEqual(137 - 24);
});

test("single-point visual content stays finite and centers at normal zoom", () => {
  const editor = camera({ box: [3, -4, 3, -4] });
  fitKetcherCanvas(editor);
  expect(editor.zoom()).toBe(1);
  expect(editor.render.options.offset.x).toBeCloseTo(207 / 2 - 3 * 40);
  expect(editor.render.options.offset.y).toBeCloseTo(402 / 2 + 4 * 40);
});

test("empty and hidden drawings do not mutate the camera", () => {
  expect(fitKetcherCanvas(null)).toBe(false);
  const empty = camera(); empty.struct = () => ({ atoms: { size: 0 } });
  expect(fitKetcherCanvas(empty)).toBe(false); expect(empty.zoom).not.toHaveBeenCalled();
  const hidden = camera({ width: 0, height: 0 });
  expect(fitKetcherCanvas(hidden)).toBe(false); expect(hidden.zoom).not.toHaveBeenCalled();
});

test.each(["setOffset", "setPaperSize", "obj2view", "view2obj"])("unsupported native %s fails before changing the view", method => {
  const editor = camera(); editor.render[method] = undefined;
  expect(() => fitKetcherCanvas(editor)).toThrow("Ketcher camera API is unavailable");
  expect(editor.zoom).not.toHaveBeenCalled();
});

test("a fully selected tall drawing fits the actual native rotation-control envelope", () => {
  const editor = camera({ width: 689, height: 402 });
  const { render } = editor;
  editor.rotateController.boundingRect = { getBBox: () => ({
    x: render.options.offset.x - 23, y: render.options.offset.y - 23,
    width: 42 * 40 + 46, height: 38 * 40 + 46,
  }) };
  editor.rotateController.handle = { getBBox: () => ({
    x: render.options.offset.x + 21 * 40 - 10, y: render.options.offset.y - 58,
    width: 20, height: 20,
  }) };
  fitKetcherCanvas(editor);
  expect(editor.zoom()).toBeCloseTo((402 - 24) / (38 * 40 + 81), 10);
  const handle = editor.rotateController.handle.getBBox();
  expect(handle.y * editor.zoom()).toBeGreaterThanOrEqual(11);
  expect((handle.y + handle.height) * editor.zoom()).toBeLessThan(402 - 11);
});

test("invalid native geometry is not silently accepted", () => {
  const editor = camera({ box: [0, 0, Number.NaN, 4] });
  expect(() => fitKetcherCanvas(editor)).toThrow("Ketcher view bounds are invalid");
  expect(editor.zoom).not.toHaveBeenCalled();
});

test("an explicit camera zoom does not import chemistry or enter undo history", () => {
  const editor = camera(); const chemical = JSON.stringify(editor.struct()), selection = JSON.stringify(editor.selection());
  zoomKetcherCanvas(editor, 1.25); expect(editor.zoom()).toBeCloseTo(.05);
  expect(JSON.stringify(editor.struct())).toBe(chemical); expect(JSON.stringify(editor.selection())).toBe(selection);
  expect(editor.event.selectionChange.dispatch).toHaveBeenCalledWith(editor.selection());
  expect(editor.event.change.dispatch).not.toHaveBeenCalled();
});
test("explicit zoom validates native scale and bounds magnification", () => {
  const editor = camera({ zoom: 3.5 }); zoomKetcherCanvas(editor, 1.25); expect(editor.zoom()).toBe(4);
  expect(() => zoomKetcherCanvas(editor, Number.NaN)).toThrow("Ketcher view bounds are invalid");
});

test("a resized manually zoomed view centers without silently returning to full fit", () => {
  const editor = camera({ zoom: .4 });
  fitKetcherCanvas(editor, { preserveZoom: true });
  expect(editor.zoom()).toBe(.4);
  const b = editor.render.ctab.getVBoxObj(), a = editor.render.obj2view(b.p0), z = editor.render.obj2view(b.p1);
  expect((a.x + z.x) / 2).toBeCloseTo(207 / 2, 8);
  expect((a.y + z.y) / 2).toBeCloseTo(402 / 2, 8);
});

test.each([.25, .5, 1, 3.2])("native paper offsets at zoom %s update scroll in CSS pixels", zoom => {
  const editor = camera({ zoom }), render = editor.render;
  // Exact bundled setOffset protocol: paper-unit deltas were applied unscaled to CSS scroll.
  render.setOffset = function(value) {
    this.clientArea.scrollLeft += value.x - this.options.offset.x;
    this.clientArea.scrollTop += value.y - this.options.offset.y;
    this.options.offset = value;
  };
  fitKetcherCanvas(editor, { preserveZoom: true });
  render.clientArea.scrollLeft = 100; render.clientArea.scrollTop = 100;
  const offset = render.options.offset.add(new Point(-10, 15));
  render.setOffset(offset);
  expect(render.clientArea.scrollLeft).toBeCloseTo(100 - 10 * zoom, 8);
  expect(render.clientArea.scrollTop).toBeCloseTo(100 + 15 * zoom, 8);
  expect(render.options.offset).toBe(offset);
  const adapted = render.setOffset;
  fitKetcherCanvas(editor, { preserveZoom: true });
  expect(render.setOffset).toBe(adapted);
});

test("invalid paper-offset input cannot corrupt the view and chemistry", () => {
  const editor = camera(), render = editor.render;
  fitKetcherCanvas(editor);
  const offset = render.options.offset, chemistry = JSON.stringify(editor.struct());
  expect(() => render.setOffset(new Point(Number.NaN, 0))).toThrow("Ketcher view bounds are invalid");
  expect(render.options.offset).toBe(offset);
  expect(render.clientArea.scrollLeft).toBe(0);
  expect(JSON.stringify(editor.struct())).toBe(chemistry);
});

test("rounded DOM scrolling cannot accumulate high-zoom paper-offset error", () => {
  const editor = camera({ zoom: 3.215520359 }), render = editor.render;
  let x = 0, y = 0;
  Object.defineProperties(render.clientArea, {
    scrollLeft: { get: () => x, set: value => { x = Math.round(value); } },
    scrollTop: { get: () => y, set: value => { y = Math.round(value); } },
  });
  fitKetcherCanvas(editor, { preserveZoom: true });
  render.clientArea.scrollLeft = 500; render.clientArea.scrollTop = 500;
  for (let i = 0; i < 10; i++) render.setOffset(render.options.offset.add(new Point(-2, 3)));
  expect(Math.abs(x - (500 - 20 * editor.zoom()))).toBeLessThanOrEqual(.5);
  expect(Math.abs(y - (500 + 30 * editor.zoom()))).toBeLessThanOrEqual(.5);
});

test("native paper cropping cannot remove the current viewport or a requested scroll target", () => {
  const editor = camera({ zoom: .5 }), render = editor.render;
  fitKetcherCanvas(editor, { preserveZoom: true });
  render.clientArea.scrollLeft = 200; render.clientArea.scrollTop = 150;
  render.setPaperSize(new Point(50, 50));
  expect(render.sz.x * editor.zoom()).toBeGreaterThanOrEqual(200 + render.clientArea.clientWidth);
  expect(render.sz.y * editor.zoom()).toBeGreaterThanOrEqual(150 + render.clientArea.clientHeight);
  render.setOffset(render.options.offset.add(new Point(1000, 1000)));
  expect(render.sz.x * editor.zoom()).toBeGreaterThanOrEqual(render.clientArea.scrollLeft + render.clientArea.clientWidth);
  expect(render.sz.y * editor.zoom()).toBeGreaterThanOrEqual(render.clientArea.scrollTop + render.clientArea.clientHeight);
  const expanded = render.sz;
  fitKetcherCanvas(editor, { preserveZoom: true });
  expect(render.sz.x).toBeLessThan(expanded.x);
  expect(render.sz.y).toBeLessThan(expanded.y);
});

test("native zoom retains its own anchor transaction and failed zoom releases paper protection", () => {
  const editor = camera({ zoom: .5 }), render = editor.render, nativeZoom = editor.zoom;
  let fail = false;
  editor.zoom = function(value) {
    if (!arguments.length) return nativeZoom();
    if (fail) throw new Error("Native zoom failure");
    nativeZoom(value); render.setPaperSize(new Point(20, 20));
    return nativeZoom();
  };
  fitKetcherCanvas(editor, { preserveZoom: true });
  editor.zoom(.75); expect(render.sz.x).toBe(20);
  fail = true; expect(() => editor.zoom(1)).toThrow("Native zoom failure");
  render.setPaperSize(new Point(10, 10));
  expect(render.sz.x * editor.zoom()).toBeGreaterThanOrEqual(render.clientArea.clientWidth);
});

test("overflowing derived paper extent cannot replace the last finite canvas", () => {
  const editor = camera(), render = editor.render;
  fitKetcherCanvas(editor); const previous = render.sz;
  render.setZoom(Number.MIN_VALUE);
  expect(() => render.setPaperSize(new Point(1000, 1000))).toThrow("Ketcher view bounds are invalid");
  expect(render.sz).toBe(previous);
});
