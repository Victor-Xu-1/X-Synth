import { computed, onScopeDispose, ref, shallowRef, toValue, watch } from "vue";
import { API } from "@/common/api";
import { documentDeliveryReview, sourceChemistryUnchanged } from "@/common/document-navigation";
import { documentSourceBinding, documentSourceError, readDocumentSourceEvidence } from "@/common/document-source-evidence";

export function useDocumentSourceEvidence(document, graph, { active = true, chemistryEdited = false } = {}) {
  const loaded = shallowRef(null), loading = ref(false), unavailable = shallowRef(null), error = ref("");
  const retired = ref(false);
  let generation = 0, controller = null, disposed = false, owner = "";
  const context = computed(() => JSON.stringify([document.value?.id, document.value?.revision,
    document.value?.metadata?.chemical_signature, document.value?.state, document.value?.source]));
  const unchanged = computed(() => sourceChemistryUnchanged(document.value, graph.value));
  const eligible = computed(() => !disposed && toValue(active) && unchanged.value
    && !toValue(chemistryEdited) && !retired.value);
  function cancel() {
    generation++;
    controller?.abort(); controller = null;
    loading.value = false; loaded.value = null; unavailable.value = null; error.value = "";
  }
  async function retry() {
    if (!eligible.value || loading.value) return;
    cancel();
    const value = document.value, binding = documentSourceBinding(value);
    if (!binding) { unavailable.value = { reason: "chemical_signature_missing" }; return; }
    const current = generation, key = context.value, request = new AbortController();
    controller = request; loading.value = true;
    const isCurrent = () => !disposed && current === generation && key === context.value && eligible.value;
    try {
      const response = await API.get(`/api/v1/route-documents/${encodeURIComponent(binding.document_id)}/source-evidence`,
        null, false, { signal: request.signal, timeoutMs: API.pollRequestTimeoutMs });
      if (!isCurrent()) return;
      const evidence = readDocumentSourceEvidence(response, value);
      if (evidence.status === "available") loaded.value = evidence;
      else unavailable.value = evidence;
    } catch (cause) {
      if (isCurrent()) error.value = documentSourceError(cause);
    } finally {
      if (isCurrent()) { loading.value = false; controller = null; }
    }
  }
  watch([context, () => toValue(active), unchanged, () => toValue(chemistryEdited)], ([key]) => {
    if (owner !== key) { cancel(); owner = key; retired.value = false; }
    if (toValue(active) && document.value?.state === "source_copy"
      && (!unchanged.value || toValue(chemistryEdited))) retired.value = true;
    if (!eligible.value) { cancel(); return; }
    if (!loaded.value && !loading.value && !unavailable.value && !error.value) retry();
  }, { immediate: true, flush: "sync" });
  const evidence = computed(() => eligible.value ? loaded.value : null);
  const deliveryReview = computed(() => !eligible.value ? null
    : evidence.value ? evidence.value.metadata.delivery_review : documentDeliveryReview(document.value, graph.value));
  const automatedReview = computed(() => evidence.value?.metadata.automated_review ?? null);
  const stepsByNode = computed(() => evidence.value?.steps_by_node ?? {});
  function retire() { if (document.value?.state === "source_copy") { retired.value = true; cancel(); } }
  onScopeDispose(() => { disposed = true; cancel(); });
  return { loaded: evidence, loading, unavailable, error, retired, deliveryReview, automatedReview, stepsByNode, retry, retire };
}
