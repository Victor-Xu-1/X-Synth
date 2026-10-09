import { nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { referenceFailure, referenceReactionFileBody } from "@/common/reaction-references";

export function useReferenceReuse({
  canvas, reactionSmiles, response, loading, linkedInput, proposal, layer, returnToRecords,
}) {
  const phase = ref(""), record = shallowRef(null), error = ref("");
  let generation = 0, disposed = false, context = null;

  function reset() {
    const previous = context;
    generation++;
    context = null;
    phase.value = "";
    record.value = null;
    error.value = "";
    // Release only this worker's staged import before ending query suspension.
    if (previous) previous.canvas.cancelImport();
    proposal.value = false;
    return !!previous;
  }
  watch([reactionSmiles, response, linkedInput], reset, { flush: "sync" });

  function current(value) {
    return !disposed && context === value && value.generation === generation
      && response.value === value.response && reactionSmiles.value === value.input
      && canvas.value === value.canvas && !loading.value && !linkedInput.value;
  }
  function sourceRecord(records, id) {
    return response.value?.results.find(row => {
      if (id && row.id !== id) return false;
      try {
        const body = referenceReactionFileBody(row);
        return Object.keys(body).every(role => JSON.stringify(body[role]) === JSON.stringify(records?.[role]));
      }
      catch { return false; }
    });
  }
  async function load(records, id) {
    if (disposed || loading.value || linkedInput.value || !canvas.value || canvas.value.pending
      || phase.value === "preparing" || phase.value === "preview") return false;
    const selected = sourceRecord(records, id);
    if (!selected) return false;
    const value = {
      generation: ++generation, response: response.value, input: reactionSmiles.value, canvas: canvas.value,
    };
    context = value;
    record.value = selected;
    error.value = "";
    phase.value = "preparing";
    // Suspending this same accepted query is not a chemical revision.
    proposal.value = true;
    await nextTick();
    if (!current(value)) return false;
    layer.value = "query";
    await nextTick();
    if (!current(value)) return false;
    try {
      const staged = await value.canvas.importRecords(referenceReactionFileBody(selected));
      if (!current(value)) return false;
      phase.value = staged ? "preview" : "error";
      if (!staged) error.value = "记录操作失败，请重试。";
      proposal.value = staged;
      if (staged && !value.canvas.pending) finishPreview(value);
      return staged;
    } catch (failure) {
      if (current(value)) {
        error.value = referenceFailure(failure, "记录操作失败，请重试。");
        phase.value = "error";
        proposal.value = false;
      }
      return false;
    }
  }
  function finishPreview(value) {
    if (!current(value)) return;
    reset();
    returnToRecords();
  }
  watch(() => !!canvas.value?.pending, pending => {
    if (!pending && phase.value === "preview" && context) finishPreview(context);
  }, { flush: "sync" });

  function cancel() {
    const value = context;
    if (!value || !current(value)) return;
    reset();
    returnToRecords();
  }
  onBeforeUnmount(() => { disposed = true; reset(); });
  return { phase, record, error, load, cancel, reset };
}
