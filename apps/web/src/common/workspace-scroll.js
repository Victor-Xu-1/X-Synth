import { restoreWorkspacePosition } from "./workspace-scroll-owner";

/** One router-owned scroll authority for the workspace's inner viewport. */
export function createWorkspaceScroll(history, getScroller = () => document.querySelector("#workspace-content")) {
  const positions = new Map();
  const entry = () => Number.isSafeInteger(history.state?.position) ? history.state.position : null;
  let currentEntry = entry(), currentRoute, owner, desired;

  function stop() {
    owner?.stop();
    owner = undefined;
    desired = undefined;
  }
  function capture() {
    const element = getScroller();
    if (element && currentEntry !== null) positions.set(currentEntry, owner?.pending ? desired : {
      top: element.scrollTop, left: element.scrollLeft,
    });
  }
  function committed(to, _from, failure) {
    if (failure) return;
    stop();
    currentEntry = entry();
    currentRoute = to;
  }
  function restore(element, position) {
    desired = position;
    owner = restoreWorkspacePosition(element, position);
  }
  function scrollBehavior(to, from, savedPosition) {
    if (currentRoute !== to) return false;
    const element = getScroller();
    if (!element) return savedPosition || { left: 0, top: 0 };
    const previous = savedPosition && positions.get(currentEntry);
    if (previous || to.path !== from.path) restore(element, previous || { left: 0, top: 0 });
    return false;
  }
  return { capture, committed, scrollBehavior, stop };
}
