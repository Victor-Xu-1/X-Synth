import { createWorkspaceScroll } from "./workspace-scroll";

let element, history, controller, resizeCallback;
const route = path => ({ path });
beforeEach(() => {
  element = document.createElement("main"); document.body.append(element);
  history = { state: { position: 1 } };
  global.ResizeObserver = class {
    constructor(callback) { resizeCallback = callback; }
    observe() {} disconnect() {}
  };
  controller = createWorkspaceScroll(history, () => element);
});
afterEach(() => { controller.stop(); element.remove(); });

test("new tool opens at its input instead of inheriting the previous scroll", () => {
  const from = route("/references"), to = route("/forward");
  element.scrollTop = 450; controller.capture();
  history.state.position = 2; controller.committed(to, from);
  expect(controller.scrollBehavior(to, from, null)).toBe(false);
  expect(element.scrollTop).toBe(0);
});

test("back and forward restore coordinates by history entry rather than URL", () => {
  const first = route("/references"), second = route("/forward"), third = route("/references");
  element.scrollTop = 403; controller.capture();
  history.state.position = 2; controller.committed(second, first); controller.scrollBehavior(second, first, null);
  element.scrollTop = 123; controller.capture();
  history.state.position = 3; controller.committed(third, second); controller.scrollBehavior(third, second, null);
  element.scrollTop = 99; controller.capture();
  history.state.position = 1; controller.committed(first, third); controller.scrollBehavior(first, third, { top: 0, left: 0 });
  expect(element.scrollTop).toBe(403);
  history.state.position = 2; controller.committed(second, first); controller.scrollBehavior(second, first, { top: 0, left: 0 });
  expect(element.scrollTop).toBe(123);
});

test("same-path query navigation preserves reading position and focus", () => {
  const from = route("/forward"), to = route("/forward");
  element.tabIndex = -1; element.focus(); element.scrollTop = 125;
  controller.capture(); history.state.position = 2; controller.committed(to, from);
  controller.scrollBehavior(to, from, null);
  expect(element.scrollTop).toBe(125); expect(document.activeElement).toBe(element);
});

test("failed or late navigation cannot publish another page's restoration", () => {
  const from = route("/references"), stale = route("/forward"), current = route("/process");
  controller.committed(current, from); element.scrollTop = 111;
  controller.committed(stale, current, new Error("navigation aborted"));
  expect(controller.scrollBehavior(stale, from, null)).toBe(false);
  expect(element.scrollTop).toBe(111);
});

test("async content restores only while its owner remains active", () => {
  const from = route("/references"), to = route("/forward");
  element.scrollTop = 450; controller.capture();
  history.state.position = 2; controller.committed(to, from);
  controller.scrollBehavior(to, from, null);
  let maximum = 10, top = 0;
  Object.defineProperty(element, "scrollTop", { configurable: true,
    get: () => top, set: value => { top = Math.min(maximum, value); } });
  history.state.position = 1; controller.committed(from, to);
  controller.scrollBehavior(from, to, { top: 0, left: 0 });
  expect(top).toBe(10);
  maximum = 500; resizeCallback(); expect(top).toBe(450);
  top = 0; resizeCallback(); expect(top).toBe(0);
});

test("user interaction retires an unreachable pending restoration", () => {
  const first = route("/references"), second = route("/forward");
  element.scrollTop = 403; controller.capture();
  history.state.position = 2; controller.committed(second, first);
  let top = 0;
  Object.defineProperty(element, "scrollTop", { configurable: true,
    get: () => top, set: value => { top = Math.min(10, value); } });
  history.state.position = 1; controller.committed(first, second);
  controller.scrollBehavior(first, second, { top: 0, left: 0 });
  element.dispatchEvent(new Event("wheel")); top = 0;
  resizeCallback(); expect(top).toBe(0);
});
