import { installKetcherScrollCoordinates, resetKetcherScrollCoordinates } from "./ketcher-scroll";

// Integer DOM-scroll protocol isolation; actual SDK/SVG movement is verified in Chrome.
function renderer(zoom = 1) {
  let x = 100, y = 100;
  const area = Object.assign(new EventTarget(), { scrollWidth: 1000, scrollHeight: 1000, clientWidth: 500, clientHeight: 500 });
  Object.defineProperties(area, {
    scrollLeft: { get: () => x, set: value => { x = Math.max(0, Math.min(500, Math.round(value))); } },
    scrollTop: { get: () => y, set: value => { y = Math.max(0, Math.min(500, Math.round(value))); } },
  });
  const render = { options: { zoom, offset: { x: 0, y: 0 } }, clientArea: area, setOffset() {},
    setZoom(value) { this.options.zoom = value; } };
  installKetcherScrollCoordinates(render);
  return render;
}
function move(render, x, y = 0) {
  render.setOffset({ x: render.options.offset.x + x, y: render.options.offset.y + y });
}

test.each([0, 500])("clamped subpixel offsets at %s cannot delay a later opposite movement", edge => {
  const render = renderer(), direction = edge === 0 ? -1 : 1;
  render.clientArea.scrollLeft = edge;
  move(render, direction * .4); move(render, direction * .4);
  move(render, direction * -.6);
  expect(render.clientArea.scrollLeft).toBe(edge === 0 ? 1 : 499);
});

test("user scrolling replaces the old rounding origin", () => {
  const render = renderer(); move(render, .3);
  render.clientArea.scrollLeft = 200; move(render, .3);
  expect(render.clientArea.scrollLeft).toBe(200);
});

test("scroll and native zoom roundtrips cannot revive old rounding residue", () => {
  const render = renderer(); move(render, .3);
  render.clientArea.scrollLeft = 200; render.clientArea.dispatchEvent(new Event("scroll"));
  render.clientArea.scrollLeft = 100; render.clientArea.dispatchEvent(new Event("scroll"));
  move(render, .3); expect(render.clientArea.scrollLeft).toBe(100);
  render.setZoom(2); render.setZoom(1);
  move(render, .3); expect(render.clientArea.scrollLeft).toBe(100);
});

test("real input intent clears coalesced user movement but own scroll events retain precision", () => {
  const render = renderer(); move(render, .3);
  render.clientArea.dispatchEvent(new Event("scroll"));
  move(render, .3); expect(render.clientArea.scrollLeft).toBe(101);
  render.clientArea.dispatchEvent(new Event("pointerdown"));
  move(render, .3); expect(render.clientArea.scrollLeft).toBe(101);
});

test("zoom and explicit fit reset old CSS remainder without stacking an adapter", () => {
  const render = renderer(), adapted = render.setOffset;
  move(render, .3); render.options.zoom = 2; move(render, .2);
  expect(render.clientArea.scrollLeft).toBe(100);
  resetKetcherScrollCoordinates(render); move(render, .2);
  expect(render.clientArea.scrollLeft).toBe(100);
  installKetcherScrollCoordinates(render); expect(render.setOffset).toBe(adapted);
});

test("overflowing coordinate conversion cannot publish an offset or mutate either scroll axis", () => {
  const render = renderer(4);
  render.options.offset = { x: -Number.MAX_VALUE, y: 0 };
  const previous = render.options.offset;
  expect(() => render.setOffset({ x: Number.MAX_VALUE, y: 1 })).toThrow("Ketcher view bounds are invalid");
  expect(render.options.offset).toBe(previous);
  expect(render.clientArea.scrollLeft).toBe(100); expect(render.clientArea.scrollTop).toBe(100);
});
