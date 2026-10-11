import { nextTick, onBeforeUnmount, toValue, watch } from "vue";
import { useWorkbenchActivity } from "@/components/workspace/workbench-activity";

const element = value => value?.$el || value;
export function useEditorInspectorFocus({ selected, context, locked, canvas, inspector }) {
  const activity = useWorkbenchActivity();
  let generation = 0, origin = null, disposed = false;
  const invalidate = () => { generation++; origin = null; };
  const current = (epoch, identity, id) => !disposed && activity.value && !toValue(locked)
    && generation === epoch && toValue(context) === identity && selected.value === id;
  watch([selected, activity, () => toValue(context)], invalidate, { flush: "sync" });

  async function select(id, event) {
    if (disposed || !activity.value || toValue(locked)) return;
    selected.value = id;
    const epoch = ++generation, identity = toValue(context), surface = element(canvas.value);
    const entry = event?.target?.closest?.('button, a[href], input, [tabindex]') || event?.currentTarget;
    origin = id && surface?.contains(entry) ? { element: entry, identity } : null;
    if (!id || !origin || (window.innerWidth > 1100 && event?.detail !== 0)) return;
    const owner = entry.ownerDocument, focused = owner.activeElement;
    await nextTick();
    const target = element(inspector.value);
    if (!current(epoch, identity, id) || !target?.isConnected || target.closest('[hidden], [inert], [aria-hidden="true"]')
      || ![focused, owner.body, owner.documentElement].includes(owner.activeElement)) return;
    target.scrollIntoView?.({ block: "nearest" });
    target.focus({ preventScroll: true });
  }

  async function close() {
    if (disposed || !activity.value || toValue(locked)) return;
    const point = origin, owner = point?.element.ownerDocument, focused = owner?.activeElement;
    selected.value = null;
    const epoch = ++generation;
    origin = null;
    await nextTick();
    const target = point?.element;
    if (!current(epoch, point?.identity, null) || !target?.isConnected || !element(canvas.value)?.contains(target)
      || target.disabled || !target.getClientRects().length || target.closest('[hidden], [inert], [aria-hidden="true"]')
      || ![focused, owner.body, owner.documentElement, target].includes(owner.activeElement)) return;
    target.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    target.focus({ preventScroll: true });
  }
  onBeforeUnmount(() => { disposed = true; invalidate(); });
  return { select, close };
}
