import { workbenchMenuProps, workbenchOverlayDefaults } from "./workbench-overlays";

test("a registered active owner does not override the widget's own disabled or model state", () => {
  const target = document.createElement("section");
  expect(workbenchMenuProps(true, target)).toEqual({ attach: target });
});

test.each([null, undefined])("an unregistered owner suspends presentation instead of opening a body portal", target => {
  expect(workbenchMenuProps(true, target)).toEqual({ attach: target, disabled: true, modelValue: false });
});

test("an inactive owner suspends only presentation, retaining the exact owner", () => {
  const target = document.createElement("section");
  expect(workbenchMenuProps(false, target)).toEqual({ attach: target, disabled: true, modelValue: false });
});

test("all native selector and overlay defaults share the same suspension policy", () => {
  const target = document.createElement("section");
  const defaults = workbenchOverlayDefaults(false, target);
  const expected = { attach: target, disabled: true, modelValue: false };
  expect(defaults.VMenu).toEqual(expected);
  expect(defaults.VTooltip).toEqual(expected);
  for (const name of ["VSelect", "VAutocomplete", "VCombobox"]) expect(defaults[name].menuProps).toEqual(expected);
});
