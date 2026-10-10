import { inputLocation, createInputDraftNavigation } from "./input-draft-navigation";

test("input context ignores only hash navigation and rejects external or missing locations", () => {
  expect(inputLocation("/process?record=a#workspace-content")).toBe("/process?record=a");
  expect(inputLocation("/process?smiles=C%23N#input")).toBe("/process?smiles=C%23N");
  expect([null, "https://other.example/process", "//other.example/process", "/\\[invalid"].map(value => inputLocation(value))).toEqual([null, null, null, null]);
});
test("dirty scientific input blocks destructive navigation until explicit approval, not local hash focus", () => {
  let value = "20"; const confirm = jest.fn().mockReturnValue(false);
  const state = createInputDraftNavigation({ snapshot: () => value, confirm });
  expect(state.guard({ fullPath: "/analyses" }, { fullPath: "/process" })).toBe(true);
  state.accept(); value = "12.345";
  expect(state.dirty()).toBe(true);
  expect(state.guard({ fullPath: "/process#workspace-content" }, { fullPath: "/process" })).toBe(true);
  expect(confirm).not.toHaveBeenCalled();
  expect(state.guard({ fullPath: "/analyses" }, { fullPath: "/process" })).toBe(false);
  expect(state.dirty()).toBe(true);
  confirm.mockReturnValue(true); expect(state.discard()).toBe(true);
  state.accept(); expect(state.dirty()).toBe(false);
});
test("unload protection is released for committed inputs and disposed owners", () => {
  let value = "original"; const state = createInputDraftNavigation({ snapshot: () => value, confirm: () => false });
  state.accept(); value = "edited";
  const event = { preventDefault: jest.fn(), returnValue: "untouched" }; state.beforeUnload(event);
  expect(event.preventDefault).toHaveBeenCalled(); expect(event.returnValue).toBe("");
  state.accept(); event.preventDefault.mockClear(); state.beforeUnload(event); expect(event.preventDefault).not.toHaveBeenCalled();
  value = "another edit"; state.dispose(); expect(state.dirty()).toBe(false);
});
