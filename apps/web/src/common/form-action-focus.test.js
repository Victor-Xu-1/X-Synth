import { bindFormActionFocus } from "./form-action-focus";

test("reveals only an actually covered active native field and releases its exact form listener", () => {
  const form = document.createElement("form"), field = document.createElement("input"), footer = document.createElement("footer");
  const action = document.createElement("button"); footer.append(action); form.append(field, footer); document.body.append(form);
  const fieldRect = { top: 500, bottom: 544, left: 20, right: 300, width: 280, height: 44 };
  field.getBoundingClientRect = () => fieldRect;
  footer.getBoundingClientRect = () => ({ top: 503, bottom: 640, left: 16, right: 374, width: 358, height: 137 });
  field.scrollIntoView = jest.fn();
  const release = bindFormActionFocus(footer);
  field.focus();
  expect(field.scrollIntoView).toHaveBeenCalledWith({ block: "center", inline: "nearest", behavior: "instant" });
  field.scrollIntoView.mockClear();
  fieldRect.top = 200; fieldRect.bottom = 244;
  field.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  expect(field.scrollIntoView).not.toHaveBeenCalled();
  fieldRect.top = 500; fieldRect.bottom = 544; form.inert = true; form.setAttribute("inert", "");
  field.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  expect(field.scrollIntoView).not.toHaveBeenCalled();
  form.removeAttribute("inert"); release();
  field.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  expect(field.scrollIntoView).not.toHaveBeenCalled();
  form.remove();
});

test("does not capture commands, other forms, retired fields or a surface without its form", () => {
  const form = document.createElement("form"), other = document.createElement("form"), field = document.createElement("input");
  const footer = document.createElement("footer"), button = document.createElement("button");
  footer.append(button); other.append(field); form.append(footer); document.body.append(form, other);
  field.scrollIntoView = jest.fn(); button.scrollIntoView = jest.fn();
  const release = bindFormActionFocus(footer);
  field.focus(); button.focus();
  expect(field.scrollIntoView).not.toHaveBeenCalled(); expect(button.scrollIntoView).not.toHaveBeenCalled();
  release(); form.remove(); other.remove();
  expect(() => bindFormActionFocus(document.createElement("footer"))()).not.toThrow();
});
