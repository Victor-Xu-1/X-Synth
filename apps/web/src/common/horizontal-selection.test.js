import { revealHorizontalSelection } from "./horizontal-selection";

const hosts = [];
function strip({ width = 180, total = 400, x = 260, itemWidth = 120, border = 0 } = {}) {
  const host = document.createElement("div"), target = document.createElement("button");
  document.body.appendChild(host); host.appendChild(target); hosts.push(host);
  Object.defineProperties(host, { clientWidth: { value: width }, scrollWidth: { value: total }, clientLeft: { value: border } });
  host.getBoundingClientRect = () => ({ left: 20, right: 20 + width });
  target.getBoundingClientRect = () => ({ left: 20 + border + x - host.scrollLeft,
    right: 20 + border + x + itemWidth - host.scrollLeft, width: itemWidth, height: 40 });
  return { host, target };
}
afterEach(() => hosts.splice(0).forEach(host => host.remove()));

test("only the necessary local horizontal offset is applied and a second call is stable", () => {
  const { host, target } = strip({ border: 2 });
  revealHorizontalSelection(host, target); expect(host.scrollLeft).toBe(208);
  revealHorizontalSelection(host, target); expect(host.scrollLeft).toBe(208);
});
test("end-of-strip offsets are clamped; oversized labels align their start", () => {
  const end = strip({ total: 300 });
  revealHorizontalSelection(end.host, end.target); expect(end.host.scrollLeft).toBe(120);
  const wide = strip({ itemWidth: 220 });
  revealHorizontalSelection(wide.host, wide.target); expect(wide.host.scrollLeft).toBe(220);
});
test("returning to the first control cannot produce a negative offset", () => {
  const { host, target } = strip({ x: 0 }); host.scrollLeft = 120;
  revealHorizontalSelection(host, target); expect(host.scrollLeft).toBe(0);
});
test("unmounted, unrelated and zero-width surfaces are ignored", () => {
  const { host, target } = strip({ width: 0 });
  revealHorizontalSelection(host, target); expect(host.scrollLeft).toBe(0);
  revealHorizontalSelection(host, document.createElement("button")); expect(host.scrollLeft).toBe(0);
  host.remove(); revealHorizontalSelection(host, target); expect(host.scrollLeft).toBe(0);
  revealHorizontalSelection(null, target);
});
