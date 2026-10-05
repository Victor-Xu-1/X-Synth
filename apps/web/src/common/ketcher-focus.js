// Ketcher 2.13 focuses its clipboard during initialization and structure imports.
// Keep those programmatic focus changes from scrolling a multi-editor workspace.
export function createKetcherFocusGuard(getFrame, syncing) {
  let host, document, snapshot;
  function capture(fromInteraction = false) {
    const frame = getFrame();
    if (!frame) return;
    const owner = frame.ownerDocument;
    if (
      snapshot &&
      !fromInteraction &&
      owner.activeElement?.tagName === "IFRAME"
    )
      return;
    const ancestors = [];
    for (
      let element = frame.parentElement;
      element;
      element = element.parentElement
    )
      ancestors.push({
        element,
        left: element.scrollLeft,
        top: element.scrollTop,
      });
    const view = owner.defaultView;
    snapshot = {
      ancestors,
      view,
      left: view.scrollX,
      top: view.scrollY,
      active: owner.activeElement,
    };
  }
  function restore() {
    if (!syncing() || !snapshot) return;
    for (const { element, left, top } of snapshot.ancestors) {
      element.scrollLeft = left;
      element.scrollTop = top;
    }
    snapshot.view.scrollTo(snapshot.left, snapshot.top);
    if (snapshot.active?.isConnected && snapshot.active.tagName !== "IFRAME")
      snapshot.active.focus({ preventScroll: true });
  }
  function observe() {
    const frame = getFrame();
    if (!frame) return;
    if (!host) {
      host = frame.ownerDocument;
      capture();
      host.addEventListener("scroll", capture, true);
      host.addEventListener("pointerdown", capture, true);
      host.addEventListener("keydown", capture, true);
    }
    if (document !== frame.contentDocument) {
      document?.removeEventListener("focusin", restore, true);
      document = frame.contentDocument;
      document?.addEventListener("focusin", restore, true);
    }
    if (host.activeElement === frame) restore();
  }
  function dispose() {
    document?.removeEventListener("focusin", restore, true);
    host?.removeEventListener("scroll", capture, true);
    host?.removeEventListener("pointerdown", capture, true);
    host?.removeEventListener("keydown", capture, true);
  }
  return { capture, observe, dispose };
}
