export function bindFormActionFocus(surface) {
  const form = surface?.closest("form");
  if (!form) return () => {};
  function reveal(event) {
    const field = event.target;
    if (field !== document.activeElement || !surface.isConnected || surface.contains(field) ||
        !field.matches?.('input, textarea, select, [contenteditable="true"]') ||
        field.closest("[hidden], [inert]") || surface.closest("[hidden], [inert]")) return;
    const input = field.getBoundingClientRect(), actions = surface.getBoundingClientRect();
    if (input.width > 0 && input.height > 0 && actions.width > 0 && actions.height > 0 &&
        input.bottom > actions.top && input.top < actions.bottom &&
        input.right > actions.left && input.left < actions.right)
      field.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
  }
  form.addEventListener("focusin", reveal);
  return () => form.removeEventListener("focusin", reveal);
}
