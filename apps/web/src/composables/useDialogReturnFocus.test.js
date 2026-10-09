import { mount } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { useDialogReturnFocus } from "./useDialogReturnFocus";

jest.mock("@/components/workspace/workbench-activity", () => ({ useWorkbenchActivity: () => mockActivity }));
const mockActivity = ref(true);
let open, context, focus, wrapper, elements;
function control() {
  const button = document.createElement("button"); document.body.append(button); elements.push(button);
  jest.spyOn(button, "getClientRects").mockReturnValue([{ width: 44, height: 44 }]);
  return button;
}
beforeEach(() => {
  mockActivity.value = true; open = ref(false); context = ref("list-a"); elements = [];
  wrapper = mount(defineComponent({ setup() {
    focus = useDialogReturnFocus(open, context); return () => h("div");
  } }));
});
afterEach(() => { wrapper?.unmount(); elements.forEach(node => node.remove()); jest.restoreAllMocks(); });

test("only normal after-leave restores the origin captured before the async opening", () => {
  const trigger = control(), close = control(); trigger.focus(); focus.begin();
  focus.restore(); expect(document.activeElement).toBe(trigger);
  open.value = true; close.focus(); open.value = false;
  expect(document.activeElement).toBe(close);
  focus.restore(); expect(document.activeElement).toBe(trigger);
});

test("an old after-leave cannot consume a newer pending preview's origin", () => {
  const first = control(), second = control(), close = control();
  first.focus(); focus.begin(); open.value = true; close.focus(); open.value = false;
  second.focus(); focus.begin();
  focus.restore();
  open.value = true; close.focus(); open.value = false; focus.restore();
  expect(document.activeElement).toBe(second);
});

test("switching an already open preview does not arm restoration for its replacement read", () => {
  const first = control(), second = control(), close = control();
  first.focus(); focus.begin(); open.value = true;
  second.focus(); focus.begin(); open.value = false; focus.restore();
  open.value = true; close.focus(); open.value = false; focus.restore();
  expect(document.activeElement).toBe(second);
});

test("a nested hidden trigger uses only its still-visible list fallback", () => {
  const fallback = control(), nested = control(), close = control();
  nested.focus(); focus.begin(fallback); open.value = true; nested.hidden = true;
  close.focus(); open.value = false; focus.restore();
  expect(document.activeElement).toBe(fallback);
});

test.each(["hidden", "inert", "disabled", "detached"])("%s origins cannot receive return focus", (state) => {
  const trigger = control(), close = control(); trigger.focus(); focus.begin(); open.value = true;
  if (state === "hidden") trigger.hidden = true;
  if (state === "inert") trigger.setAttribute("inert", "");
  if (state === "disabled") trigger.disabled = true;
  if (state === "detached") trigger.remove();
  close.focus(); open.value = false; focus.restore();
  expect(document.activeElement).toBe(close);
});

test.each(["pointerdown", "keydown"])("new %s intent during closing is not overridden", (event) => {
  const trigger = control(), close = control(); trigger.focus(); focus.begin(); open.value = true;
  close.focus(); open.value = false;
  document.dispatchEvent(new Event(event, { bubbles: true }));
  focus.restore(); expect(document.activeElement).toBe(close);
});

test("a new programmatic focus during closing is respected", () => {
  const trigger = control(), close = control(), other = control(); trigger.focus(); focus.begin(); open.value = true;
  close.focus(); open.value = false; other.focus(); focus.restore();
  expect(document.activeElement).toBe(other);
});

test.each(["context", "activity", "unmount"])("%s invalidation releases pending focus", (reason) => {
  const trigger = control(), close = control(); trigger.focus(); focus.begin(); open.value = true;
  close.focus(); open.value = false;
  if (reason === "context") context.value = "list-b";
  if (reason === "activity") mockActivity.value = false;
  if (reason === "unmount") { wrapper.unmount(); wrapper = undefined; }
  focus.restore(); expect(document.activeElement).toBe(close);
});

test("an obsolete failed read cannot cancel a newer origin", () => {
  const first = control(), second = control(), close = control();
  first.focus(); const old = focus.begin(); second.focus(); focus.begin(); focus.discard(old);
  open.value = true; close.focus(); open.value = false; focus.restore();
  expect(document.activeElement).toBe(second);
});

test("a delayed leave from A cannot release B after B has opened and closed", () => {
  const first = control(), second = control(), close = control();
  first.focus(); const a = focus.begin(); open.value = true; close.focus(); open.value = false;
  second.focus(); const b = focus.begin(); open.value = true; close.focus(); open.value = false;
  focus.restore(a); expect(document.activeElement).toBe(close);
  focus.restore(b); expect(document.activeElement).toBe(second);
});

test.each(["body", "container", "failed-focus"])("a %s origin cannot consume a usable fallback", kind => {
  const fallback = control(), close = control();
  let origin = document.body;
  if (kind === "container") {
    origin = document.createElement("div"); document.body.append(origin); elements.push(origin);
    jest.spyOn(origin, "getClientRects").mockReturnValue([{ width: 44, height: 44 }]);
  }
  if (kind === "failed-focus") origin = control();
  focus.begin(fallback, origin);
  if (kind === "failed-focus") jest.spyOn(origin, "focus").mockImplementation(() => {});
  open.value = true; close.focus(); open.value = false; focus.restore();
  expect(document.activeElement).toBe(fallback);
});
