import { createKetcherFrameLifecycle } from "./ketcher-frame";

test("pagehide belongs to the current native document, not the WindowProxy identity", () => {
  const first = new EventTarget(), next = new EventTarget();
  let frame = { contentDocument: { defaultView: first } };
  const interrupted = jest.fn();
  const lifecycle = createKetcherFrameLifecycle(() => frame, interrupted);
  lifecycle.observe(); lifecycle.observe();
  first.dispatchEvent(new Event("pagehide"));
  expect(interrupted).toHaveBeenCalledTimes(1);
  frame = { contentDocument: { defaultView: next } };
  lifecycle.observe();
  first.dispatchEvent(new Event("pagehide"));
  expect(interrupted).toHaveBeenCalledTimes(1);
  next.dispatchEvent(new Event("pagehide"));
  expect(interrupted).toHaveBeenCalledTimes(2);
  lifecycle.dispose();
  next.dispatchEvent(new Event("pagehide"));
  expect(interrupted).toHaveBeenCalledTimes(2);
});
