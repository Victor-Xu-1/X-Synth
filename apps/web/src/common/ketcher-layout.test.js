import { fitKetcherCanvas, prepareKetcherDocument } from "./ketcher-layout";
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
