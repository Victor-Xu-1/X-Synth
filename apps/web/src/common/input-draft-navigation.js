export function inputLocation(value, origin = window.location.origin) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return null;
  try {
    const url = new URL(value, origin);
    return url.origin === origin ? url.pathname + url.search : null;
  } catch { return null; }
}

export function createInputDraftNavigation({ snapshot, confirm }) {
  let baseline = null, alive = true;
  const dirty = () => alive && baseline !== null && snapshot() !== baseline;
  const accept = (value = snapshot()) => { if (alive) baseline = value; };
  const discard = () => !dirty() || confirm();
  function guard(to, from) {
    const current = inputLocation(from?.fullPath);
    return current && current === inputLocation(to?.fullPath) ? true : discard();
  }
  function beforeUnload(event) {
    if (dirty()) { event.preventDefault(); event.returnValue = ""; }
  }
  return { dirty, accept, discard, guard, beforeUnload, dispose: () => { alive = false; } };
}
