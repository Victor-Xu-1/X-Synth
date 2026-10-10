import { restoreWorkspacePosition } from "./workspace-scroll-owner";

let element, owner, maximum, top, resizeCallback, observed, removed;
beforeEach(() => {
  jest.useFakeTimers();
  element = document.createElement("main"); document.body.append(element);
  maximum = 10; top = 0; observed = []; removed = [];
  Object.defineProperty(element, "scrollTop", { configurable: true,
    get: () => top, set: value => { top = Math.min(maximum, value); } });
  global.ResizeObserver = class {
    constructor(callback) { resizeCallback = callback; }
    observe(target) { observed.push(target); }
    unobserve(target) { removed.push(target); }
    disconnect() {}
  };
});
afterEach(() => { owner?.stop(); element.remove(); jest.useRealTimers(); });

test("a settled clamp retires and cannot pull the viewport after unrelated growth", () => {
  owner = restoreWorkspacePosition(element, { top: 127, left: 0 });
  expect(top).toBe(10); expect(owner.pending).toBe(true);
  jest.advanceTimersByTime(201);
  expect(owner.pending).toBe(false);
  maximum = 500; resizeCallback(); expect(top).toBe(10);
});

test("visible asynchronous content gets a finite restoration owner", () => {
  const busy = document.createElement("div"); busy.setAttribute("aria-busy", "true");
  busy.getClientRects = () => [{ width: 100, height: 20 }]; element.append(busy);
  owner = restoreWorkspacePosition(element, { top: 127, left: 0 });
  jest.advanceTimersByTime(300); expect(owner.pending).toBe(true);
  maximum = 200; resizeCallback(); expect(top).toBe(127); expect(owner.pending).toBe(false);
});

test("an indefinitely busy page cannot retain restoration after its viewport deadline", () => {
  const busy = document.createElement("div"); busy.setAttribute("aria-busy", "true");
  busy.getClientRects = () => [{ width: 100, height: 20 }]; element.append(busy);
  owner = restoreWorkspacePosition(element, { top: 127, left: 0 });
  jest.advanceTimersByTime(5001); expect(owner.pending).toBe(false);
});

test("stopped descendant events still retire the viewport's capture-phase owner", () => {
  const child = document.createElement("button"); element.append(child);
  child.addEventListener("pointerdown", event => event.stopPropagation());
  owner = restoreWorkspacePosition(element, { top: 127, left: 0 });
  child.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  expect(owner.pending).toBe(false);
  maximum = 500; resizeCallback(); expect(top).toBe(10);
});

test("replacement content joins resize observation while old targets are released", async () => {
  const old = document.createElement("section"); element.append(old);
  owner = restoreWorkspacePosition(element, { top: 127, left: 0 });
  const replacement = document.createElement("section"); old.replaceWith(replacement);
  await Promise.resolve();
  expect(observed).toContain(replacement); expect(removed).toContain(old);
  maximum = 200; resizeCallback(); expect(top).toBe(127);
});
