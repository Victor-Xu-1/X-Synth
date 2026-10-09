import { computed, onScopeDispose, shallowRef, watch } from "vue";

export function useInspectorDraftGuard({ contextId, nodeId, confirm, discard }) {
  const signal = shallowRef(null);
  let disposed = false;
  const matches = value => !disposed && !!contextId() && !!nodeId() &&
    value?.contextId === contextId() && value?.nodeId === nodeId();
  const dirty = computed(() => matches(signal.value) && signal.value?.dirty === true);
  const revision = computed(() => dirty.value ? signal.value.revision : null);
  function clear() { signal.value = null; }
  function receive(value) {
    if (!matches(value) || typeof value?.dirty !== "boolean" || !Number.isInteger(value.revision)) return;
    if (matches(signal.value) && value.revision < signal.value.revision) return;
    signal.value = value;
  }
  function requestDiscard() {
    if (disposed) return false;
    if (!dirty.value) return true;
    if (!confirm() || discard() === false) return false;
    clear();
    return true;
  }
  function permitsGraphChange(current, next) {
    if (!dirty.value) return true;
    const id = nodeId();
    const fields = graph => {
      const node = graph.nodes.find(value => value.id === id);
      return node ? [node.type, node.smiles || "", node.label || "", node.note || ""] : null;
    };
    const links = graph => graph.edges.filter(edge => edge.source === id || edge.target === id)
      .map(edge => JSON.stringify([edge.id, edge.source, edge.target, edge.input_occurrences ?? 1])).sort();
    if (JSON.stringify(fields(current)) === JSON.stringify(fields(next)) &&
      JSON.stringify(links(current)) === JSON.stringify(links(next))) return true;
    return requestDiscard();
  }
  watch([contextId, nodeId], clear, { flush: "sync" });
  onScopeDispose(() => { disposed = true; clear(); });
  return { dirty, revision, receive, requestDiscard, permitsGraphChange, clear };
}
