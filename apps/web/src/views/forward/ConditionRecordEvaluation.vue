<template>
  <section class="condition-record-evaluation" :aria-label="$tr('反应可行性复核')">
    <v-btn variant="text" prepend-icon="mdi-check-decagram-outline" :loading="loading" :disabled="loading || !available || !result.conditions.length" @click="evaluate">{{ $tr('评估反应可行性') }}</v-btn>
    <span v-if="score !== null">{{ $tr('模型可行性评分（FF）：{score}', { score: score.toFixed(3) }) }}</span>
    <p v-if="error" class="tool-error" role="alert">{{ $tr(error) }}</p>
  </section>
</template>
<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { API } from "@/common/api";
import { nativeResult } from "@/common/native-response";
import { errorMessage } from "@/common/workspace-errors";
import { useWorkspaceStore } from "@/store/workspace";
const props = defineProps({ result: { type: Object, required: true } });
const workspace = useWorkspaceStore(), available = computed(() => workspace.can("fast_filter")
  && typeof props.result.reactants === "string" && !!props.result.reactants.trim()
  && typeof props.result.product === "string" && !!props.result.product.trim());
const loading = ref(false), score = ref(null), error = ref("");
let generation = 0, disposed = false;
watch(() => props.result, () => { generation++; loading.value = false; score.value = null; error.value = ""; });
async function evaluate() {
  if (disposed || loading.value || !available.value || !props.result.conditions.length) return;
  const current = ++generation, snapshot = props.result;
  loading.value = true; error.value = ""; score.value = null;
  try {
    const value = nativeResult(await API.post("/api/fast-filter/call-sync", { smiles: [snapshot.reactants, snapshot.product] }));
    const next = typeof value === "number" ? value : value?.score;
    if (!Number.isFinite(next) || next < 0 || next > 1) throw new Error("invalid_feasibility_score");
    if (!disposed && current === generation) score.value = next;
  } catch (cause) { if (!disposed && current === generation) error.value = errorMessage(cause, "反应可行性复核未完成。"); }
  finally { if (!disposed && current === generation) loading.value = false; }
}
onBeforeUnmount(() => { disposed = true; generation++; });
</script>
<style scoped>
.condition-record-evaluation { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--ws-border); font-size: 13px; }
.tool-error { flex-basis: 100%; }
</style>
