const QUIET_MS = 200;
const DEADLINE_MS = 5000;

export function restoreWorkspacePosition(element, position) {
  let active = true, quiet;
  const targets = new Set();
  const events = ["wheel", "touchstart", "pointerdown", "keydown", "focusin"];
  const pendingContent = () => [...element.querySelectorAll('[aria-busy="true"], .workspace-loading')]
    .some(target => target.getClientRects().length && !target.closest('[hidden], [inert], [aria-hidden="true"]'));
  const stop = () => {
    if (!active) return;
    active = false;
    clearTimeout(quiet); clearTimeout(deadline);
    mutation.disconnect(); resize.disconnect(); targets.clear();
    for (const event of events) element.removeEventListener(event, stop, true);
  };
  const syncTargets = () => {
    const current = new Set([element, ...element.children]);
    for (const target of targets) if (!current.has(target)) { resize.unobserve(target); targets.delete(target); }
    for (const target of current) if (!targets.has(target)) { resize.observe(target); targets.add(target); }
  };
  const apply = () => {
    if (!active) return;
    if (!element.isConnected) { stop(); return; }
    element.scrollTop = position.top;
    element.scrollLeft = position.left;
    if (Math.abs(element.scrollTop - position.top) <= 1 && Math.abs(element.scrollLeft - position.left) <= 1) {
      stop(); return;
    }
    clearTimeout(quiet);
    // Allow initial asynchronous growth, then accept a stable reachable clamp.
    // This is viewport ownership, not a deadline on any scientific request.
    quiet = setTimeout(() => { if (!pendingContent()) stop(); }, QUIET_MS);
  };
  const mutation = new MutationObserver(() => { if (active) { syncTargets(); apply(); } });
  const resize = new ResizeObserver(apply);
  const deadline = setTimeout(stop, DEADLINE_MS);
  apply();
  if (active) {
    mutation.observe(element, { childList: true, subtree: true, attributes: true });
    syncTargets();
    for (const event of events) element.addEventListener(event, stop, { passive: true, capture: true });
  }
  return { stop, get pending() { return active; } };
}
