export function captureKetcherRecoveryFocus(event, current, restore) {
  const trigger = event?.currentTarget, document = trigger?.ownerDocument;
  if (event?.detail !== 0 || document?.activeElement !== trigger) return () => {};
  let moved = false;
  const cancel = () => { moved = true; };
  document.addEventListener("pointerdown", cancel, true);
  document.addEventListener("keydown", cancel, true);
  document.addEventListener("input", cancel, true);
  return () => {
    document.removeEventListener("pointerdown", cancel, true);
    document.removeEventListener("keydown", cancel, true);
    document.removeEventListener("input", cancel, true);
    if (!moved && current()) restore();
  };
}
