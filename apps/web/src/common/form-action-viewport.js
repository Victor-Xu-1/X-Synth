const viewports = new WeakMap();
const property = "scroll-padding-bottom";
function scrollOwner(surface) {
  const view = surface?.ownerDocument?.defaultView;
  for (let owner = surface?.parentElement; view && owner; owner = owner.parentElement)
    if (["auto", "scroll"].includes(view.getComputedStyle(owner).overflowY)) return owner;
}
function apply(owner, lease) {
  const inset = Math.max(0, ...lease.surfaces.values());
  if (inset) {
    lease.applied = `${inset}px`;
    owner.style.setProperty(property, lease.applied, lease.priority);
  } else if (lease.applied !== null && owner.style.getPropertyValue(property) === lease.applied) {
    if (lease.original) owner.style.setProperty(property, lease.original, lease.priority);
    else owner.style.removeProperty(property);
    lease.applied = null;
  }
}
export function bindFormActionViewport(surface) {
  const owner = scrollOwner(surface);
  if (!owner) return () => {};
  let lease = viewports.get(owner);
  if (!lease) {
    lease = { surfaces: new Map(), original: owner.style.getPropertyValue(property),
      priority: owner.style.getPropertyPriority(property), applied: null };
    viewports.set(owner, lease);
  }
  let active = true;
  function measure() {
    if (!active) return;
    const bounds = surface.getBoundingClientRect();
    lease.surfaces.set(surface, surface.isConnected && bounds.width > 0 && bounds.height > 0 ? Math.ceil(bounds.height) + 8 : 0);
    apply(owner, lease);
  }
  const observer = new ResizeObserver(measure);
  observer.observe(surface); measure();
  return () => {
    if (!active) return;
    active = false; observer.disconnect(); lease.surfaces.delete(surface); apply(owner, lease);
    if (!lease.surfaces.size) viewports.delete(owner);
  };
}
