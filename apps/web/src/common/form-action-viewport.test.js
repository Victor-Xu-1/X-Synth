import { bindFormActionViewport } from "./form-action-viewport";

let previousObserver, observers;
beforeEach(() => {
  observers = [];
  previousObserver = global.ResizeObserver;
  global.ResizeObserver = class {
    constructor(callback) { this.callback = callback; this.disconnect = jest.fn(); observers.push(this); }
    observe() {}
  };
});
afterEach(() => { global.ResizeObserver = previousObserver; document.body.innerHTML = ""; });
function scaffold(height = 96) {
  const viewport = document.createElement("main"), form = document.createElement("form"), surface = document.createElement("footer");
  viewport.style.overflowY = "auto";
  form.append(surface); viewport.append(form); document.body.append(viewport);
  let current = height;
  surface.getBoundingClientRect = () => ({ width: current ? 343 : 0, height: current });
  return { viewport, form, surface, setHeight: value => { current = value; } };
}
test("visible actions reserve their measured viewport clearance and update after a native resize", () => {
  const { viewport, surface, setHeight } = scaffold(), release = bindFormActionViewport(surface);
  expect(viewport.style.scrollPaddingBottom).toBe("104px");
  setHeight(128); observers[0].callback();
  expect(viewport.style.scrollPaddingBottom).toBe("136px");
  setHeight(0); observers[0].callback();
  expect(viewport.style.scrollPaddingBottom).toBe("");
  release(); expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
});
test("one viewport authority preserves the largest active surface and restores the original declaration", () => {
  const { viewport, form, surface } = scaffold(80);
  viewport.style.setProperty("scroll-padding-bottom", "12px", "important");
  const second = document.createElement("footer"); second.getBoundingClientRect = () => ({ width: 300, height: 112 }); form.append(second);
  const firstRelease = bindFormActionViewport(surface), secondRelease = bindFormActionViewport(second);
  expect(viewport.style.scrollPaddingBottom).toBe("120px");
  expect(viewport.style.getPropertyPriority("scroll-padding-bottom")).toBe("important");
  secondRelease(); expect(viewport.style.scrollPaddingBottom).toBe("88px");
  firstRelease(); expect(viewport.style.scrollPaddingBottom).toBe("12px");
  expect(viewport.style.getPropertyPriority("scroll-padding-bottom")).toBe("important");
});
test("retired resize callbacks and unowned containers cannot rewrite viewport state", () => {
  const { viewport, surface } = scaffold(), release = bindFormActionViewport(surface);
  release(); viewport.style.scrollPaddingBottom = "25px"; observers[0].callback();
  expect(viewport.style.scrollPaddingBottom).toBe("25px");
  const plain = document.createElement("footer"); document.body.append(plain);
  bindFormActionViewport(plain)();
  expect(observers).toHaveLength(1);
});
test("cleanup does not overwrite a newer external viewport declaration", () => {
  const { viewport, surface } = scaffold(), release = bindFormActionViewport(surface);
  viewport.style.scrollPaddingBottom = "20px";
  release(); expect(viewport.style.scrollPaddingBottom).toBe("20px");
});
