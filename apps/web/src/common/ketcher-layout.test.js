import { fitKetcherCanvas, prepareKetcherDocument } from "./ketcher-layout";
const nativeViewEvents = (selection = null) => ({
  selection: () => selection,
  event: {
    selectionChange: { dispatch: jest.fn() },
    change: { dispatch: jest.fn() },
  },
});
test("inline and modal editors share one responsive compatibility adapter", () => {
  prepareKetcherDocument(document);
  prepareKetcherDocument(document);
  expect(
    document.querySelectorAll("#x-synth-ketcher-responsive-style"),
  ).toHaveLength(1);
  expect(
    document.querySelector("#x-synth-ketcher-responsive-style").textContent,
  ).toContain(".Ketcher-root");
  document.querySelector("#x-synth-ketcher-responsive-style").remove();
});
test("resize fitting uses the bundled camera API, not molecular-coordinate edits", () => {
  const molecule = { atoms: { size: 12 } };
  let zoom = 1;
  const editor = {
    ...nativeViewEvents(),
    struct: () => molecule,
    zoomAccordingContent: (value) => {
      expect(value).toBe(molecule);
      zoom = 0.7;
    },
    zoom: jest.fn((value) => (value === undefined ? zoom : (zoom = value))),
  };
  expect(fitKetcherCanvas(editor)).toBe(true);
  expect(editor.zoom).toHaveBeenLastCalledWith(0.7);
});
test("empty or unavailable drawings are not mutated", () => {
  expect(fitKetcherCanvas(null)).toBe(false);
  expect(
    fitKetcherCanvas({
      struct: () => ({ atoms: { size: 0 } }),
      zoom: () => {
        throw new Error("empty canvas");
      },
      zoomAccordingContent: () => {},
    }),
  ).toBe(false);
});

test("a widened canvas restores readable zoom instead of retaining the narrow fit", () => {
  const bounds = { min: { x: 0, y: 0 }, max: { x: 12, y: 5 } };
  const before = JSON.stringify(bounds);
  const molecule = { atoms: { size: 37 }, getCoordBoundingBox: () => bounds };
  const selected = { atoms: [1, 2], bonds: [3] };
  const selectionBefore = JSON.stringify(selected);
  let zoom = 0.24;
  const editor = {
    ...nativeViewEvents(selected),
    struct: () => molecule,
    zoomAccordingContent: jest.fn(),
    zoom: jest.fn(value => value === undefined ? zoom : (zoom = value)),
    render: {
      options: { scale: 40 },
      clientArea: { getBoundingClientRect: () => ({ width: 753, height: 582 }) },
    },
  };
  expect(fitKetcherCanvas(editor)).toBe(true);
  expect(zoom).toBe(1);
  expect(editor.zoomAccordingContent).toHaveBeenCalledWith(molecule);
  expect(editor.event.selectionChange.dispatch).toHaveBeenCalledWith(selected);
  expect(editor.event.change.dispatch).not.toHaveBeenCalled();
  expect(JSON.stringify(selected)).toBe(selectionBefore);
  expect(JSON.stringify(bounds)).toBe(before);
});

test("an unsupported nonempty view does not silently report a successful fit", () => {
  const editor = {
    struct: () => ({ atoms: { size: 8 } }),
    zoom: jest.fn(),
    zoomAccordingContent: jest.fn(),
  };
  expect(() => fitKetcherCanvas(editor)).toThrow("Ketcher view update events are unavailable");
  expect(editor.zoom).not.toHaveBeenCalled();
});

test("narrow camera fitting reserves atom-label space without changing coordinates", () => {
  const bounds = { min: { x: 4, y: 3 }, max: { x: 8.5, y: 6.5 } };
  const before = JSON.stringify(bounds);
  let zoom = 1;
  const editor = {
    ...nativeViewEvents(),
    struct: () => ({ atoms: { size: 13 }, getCoordBoundingBox: () => bounds }),
    zoomAccordingContent: () => {},
    zoom: (value) => (value === undefined ? zoom : (zoom = value)),
    render: {
      options: { scale: 40 },
      clientArea: {
        getBoundingClientRect: () => ({ width: 184, height: 370 }),
      },
    },
  };
  expect(fitKetcherCanvas(editor)).toBe(true);
  expect(zoom).toBe(0.66);
  expect(JSON.stringify(bounds)).toBe(before);
});

test("a very wide reaction may fit below ten percent without clipping its content", () => {
  let zoom = 1;
  const bounds = { min: { x: 0, y: 0 }, max: { x: 96, y: 10 } };
  const editor = {
    ...nativeViewEvents(), struct: () => ({ atoms: { size: 181 }, getCoordBoundingBox: () => bounds }),
    zoomAccordingContent: () => { zoom = 0.1; },
    zoom: value => value === undefined ? zoom : (zoom = value),
    render: { options: { scale: 40 }, clientArea: { getBoundingClientRect: () => ({ width: 207, height: 402 }) } },
  };
  expect(fitKetcherCanvas(editor)).toBe(true);
  expect(zoom).toBeGreaterThan(0);
  expect(zoom).toBeLessThan(0.1);
  expect(96 * 40 * zoom).toBeLessThanOrEqual(207 - 64);
});
