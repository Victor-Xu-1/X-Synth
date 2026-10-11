import { bindKetcherDialogAccess } from "./ketcher-dialog-access";

export function createKetcherFrameLifecycle(getFrame, interrupted) {
  let document, release;
  function observe() {
    const current = getFrame()?.contentDocument;
    if (!current || current === document) return;
    release?.();
    document = current;
    const view = current.defaultView;
    const releaseDialogs = bindKetcherDialogAccess(current);
    const hidden = () => { releaseDialogs(); interrupted(); };
    view.addEventListener("pagehide", hidden);
    release = () => { view.removeEventListener("pagehide", hidden); releaseDialogs(); };
  }
  function dispose() {
    release?.();
    release = undefined;
    document = undefined;
  }
  return { observe, dispose };
}
