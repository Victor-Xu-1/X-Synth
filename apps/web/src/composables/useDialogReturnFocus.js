import { onBeforeUnmount, toValue, watch } from "vue";
import { useWorkbenchActivity } from "@/components/workspace/workbench-activity";

function usable(element) {
  return element?.isConnected && element !== element.ownerDocument.body &&
    element !== element.ownerDocument.documentElement && !element.disabled &&
    element.matches('a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]') &&
    !element.closest('[hidden], [inert], [aria-hidden="true"]') &&
    element.getClientRects().length > 0 &&
    !["hidden", "collapse"].includes(getComputedStyle(element).visibility);
}

export function useDialogReturnFocus(open, context) {
  const activity = useWorkbenchActivity();
  let generation = 0, presentedGeneration = -1, captured = null, closing = null, disposed = false;
  function interrupt() { if (closing) closing.interrupted = true; }
  function stopTracking() {
    captured?.document.removeEventListener("pointerdown", interrupt, true);
    captured?.document.removeEventListener("keydown", interrupt, true);
  }
  function release() {
    stopTracking();
    captured = null; closing = null;
  }
  function cancel() { generation++; release(); }
  function begin(fallback = null, origin = null) {
    cancel();
    if (disposed || !activity.value || typeof document === "undefined") return generation;
    captured = { document, origin: origin || document.activeElement, fallback, context: toValue(context) };
    return generation;
  }
  function discard(ticket) { if (ticket === generation) cancel(); }
  watch(open, (visible, previous) => {
    if (visible) {
      stopTracking(); closing = null;
      presentedGeneration = captured ? generation : -1;
    } else {
      if (previous && captured && activity.value && presentedGeneration === generation) {
        closing = { generation, focused: captured.document.activeElement, interrupted: false };
        captured.document.addEventListener("pointerdown", interrupt, true);
        captured.document.addEventListener("keydown", interrupt, true);
      }
      presentedGeneration = -1;
    }
  }, { flush: "sync" });
  watch([activity, () => toValue(context)], cancel, { flush: "sync" });
  function restore(ticket = generation) {
    if (ticket !== generation) return;
    const source = captured, leave = closing;
    if (!source || !leave) return;
    const current = source?.document.activeElement;
    const valid = !disposed && activity.value && !open.value && source && leave &&
      leave.generation === generation && !leave.interrupted && source.context === toValue(context) &&
      [source.document.body, source.document.documentElement, source.origin, source.fallback, leave.focused].includes(current);
    release();
    if (!valid) return;
    // A nested info dialog may have closed; only its visible list fallback is usable.
    for (const target of [source.origin, source.fallback].filter(usable)) {
      target.focus();
      if (source.document.activeElement === target) break;
    }
  }
  onBeforeUnmount(() => { disposed = true; cancel(); });
  return { begin, discard, cancel, restore };
}
