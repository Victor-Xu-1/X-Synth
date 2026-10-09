import { fitKetcherCanvas, prepareKetcherDocument } from "./ketcher-layout";

class Point {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  add(value) { return new Point(this.x + value.x, this.y + value.y); }
}

// Camera protocol isolation only; real Ketcher/RDKit identities need browser acceptance.
function camera({ width = 207, height = 402, box = [0, 0, 42, 38], zoom = .04 } = {}) {
  const selected = { atoms: [1, 2], bonds: [3] };
  const molecule = { atoms: { size: 181 }, coordinates: [[0, 0], [42, 38]] };
  const area = { scrollLeft: 39, scrollTop: 2, getBoundingClientRect: () => ({ width, height }) };
  const render = {
    options: { scale: 40, offset: new Point(-100, 250) }, clientArea: area,
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
    setPaperSize: jest.fn(),
    setOffset: jest.fn(offset => { render.options.offset = offset; }),
  };
  const editor = {
    struct: () => molecule,
    zoom: jest.fn(value => value === undefined ? zoom : (zoom = value)),
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
