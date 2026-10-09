export function createKetcherFrameLifecycle(getFrame, interrupted) {
  let document, release;
  function observe() {
    const current = getFrame()?.contentDocument;
    if (!current || current === document) return;
    release?.();
    document = current;
    const view = current.defaultView;
    view.addEventListener("pagehide", interrupted);
    release = () => view.removeEventListener("pagehide", interrupted);
  }
  function dispose() {
    release?.();
    release = undefined;
    document = undefined;
  }
  return { observe, dispose };
}
