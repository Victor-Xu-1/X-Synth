import { createKetcherFocusGuard } from "./ketcher-focus";

test("new text input intent survives late native clipboard focus during recovery", () => {
  const container = document.createElement("section"), trigger = document.createElement("button");
  const source = document.createElement("textarea"), frame = document.createElement("iframe");
  container.append(trigger, source, frame); document.body.append(container);
  const scroll = jest.spyOn(window, "scrollTo").mockImplementation(() => {});
  const guard = createKetcherFocusGuard(() => frame, () => true);
  try {
    trigger.focus(); guard.observe();
    trigger.remove(); source.focus();
    source.dispatchEvent(new Event("input", { bubbles: true }));
    const clipboard = frame.contentDocument.createElement("textarea");
    frame.contentDocument.body.append(clipboard); clipboard.focus();
    expect(document.activeElement).toBe(source);
  } finally { guard.dispose(); container.remove(); scroll.mockRestore(); }
});

test("pointer focus without typing is recorded after the browser default focus action", () => {
  const source = document.createElement("textarea"), frame = document.createElement("iframe");
  document.body.append(source, frame);
  const scroll = jest.spyOn(window, "scrollTo").mockImplementation(() => {});
  const guard = createKetcherFocusGuard(() => frame, () => true);
  try {
    guard.observe();
    source.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    source.focus();
    const clipboard = frame.contentDocument.createElement("textarea");
    frame.contentDocument.body.append(clipboard); clipboard.focus();
    expect(document.activeElement).toBe(source);
  } finally { guard.dispose(); source.remove(); frame.remove(); scroll.mockRestore(); }
});
