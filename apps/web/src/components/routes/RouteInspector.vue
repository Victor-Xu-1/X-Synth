<template>
  <aside class="route-inspector" :aria-label="$tr('结构与反应详情')">
    <header>
      <strong>{{
        node
          ? node.type === "molecule"
            ? target
              ? $tr('目标化合物')
              : $tr('中间体或原料')
            : $tr('反应步骤')
          : $tr('结构与反应详情')
      }}</strong
      ><v-btn
        icon="mdi-close"
        size="x-small"
        variant="text"
        :aria-label="$tr('关闭详情')"
        :disabled="busy"
        @click="$emit('close')"
      />
    </header>
    <div v-if="!node" class="inspector-empty">
      <v-icon icon="mdi-cursor-default-outline" size="24" />
    </div>
    <div v-else class="tool-fields">
      <StructurePreview
        v-if="node.type === 'molecule' && !editable"
        label="化合物结构"
        :smiles="node.smiles"
        :width="260"
        :height="150"
      />
      <label v-if="editable || node.label"
        ><span class="field-label">{{
          node.type === "molecule" ? $tr('化合物名称') : $tr('反应名称')
        }}</span
        ><input
          v-if="editable"
          class="workspace-input"
          v-model="label"
          maxlength="120"
          :disabled="busy"
        /><span v-else class="inspector-readonly">{{ generatedStepLabels && node.type === 'reaction' ? generatedReactionUiLabel(node.label) : node.label }}</span>
      </label>
      <StructureInput
        ref="structureInput"
        v-if="editable && node.type === 'molecule'"
        :key="`${contextId || ''}/${node.id}`"
        v-model="smiles"
        :label="target ? '目标化合物结构' : '中间体或原料结构'"
        :disabled="busy"
      />
      <details v-else-if="node.type === 'molecule'" class="inspector-smiles">
        <summary>SMILES</summary>
        <code class="workspace-code">{{ node.smiles }}</code>
      </details>
      <label v-if="editable || node.note"
        ><span class="field-label">{{ $tr('备注') }}</span
        ><textarea
          v-if="editable"
          class="workspace-input"
          v-model="note"
          rows="5"
          maxlength="4096"
          :disabled="busy"
        /><span v-else class="inspector-readonly">{{ node.note }}</span>
      </label>
      <div v-if="Number.isFinite(score)" class="workspace-muted">{{ $tr('模型分数 {value}', { value: score.toFixed(3) }) }}
      </div>
      <RouteNodeContext
        :node="node"
        :graph="graph"
        :step="step"
        :snapshot="snapshot"
        @navigate="$emit('navigate')"
      />
      <div v-if="message" class="tool-error" role="alert">{{ $tr(message) }}</div>
      <v-btn
        v-if="editable"
        variant="flat"
        color="primary"
        :loading="busy"
        :disabled="busy || structureInput?.pending"
        @click="apply"
        >{{ $tr('应用修改') }}</v-btn
      >
      <v-btn
        v-if="editable && !target"
        prepend-icon="mdi-trash-can-outline"
        variant="text"
        color="error"
        :disabled="busy"
        @click="$emit('remove')"
        >{{
          node.type === "molecule" ? $tr('删除中间体或原料') : $tr('删除反应步骤')
        }}</v-btn
      >
    </div>
  </aside>
</template>
<script setup>
import { onBeforeUnmount, ref, watch } from "vue";
import StructurePreview from "@/components/workspace/StructurePreview.vue";
import StructureInput from "@/components/workspace/StructureInput.vue";
import RouteNodeContext from "./RouteNodeContext.vue";
import { API } from "@/common/api";
import { errorMessage } from "@/common/workspace-errors";
import { generatedReactionUiLabel } from "./route-ui-text";
const props = defineProps({
  node: Object,
  editable: Boolean,
  target: Boolean,
  score: Number,
  graph: Object,
  step: Object,
  snapshot: String,
  contextId: String,
  generatedStepLabels: Boolean,
});
const emit = defineEmits(["update", "pending", "close", "remove", "navigate"]);
const structureInput = ref(null);
const label = ref(""),
  smiles = ref(""),
  note = ref(""),
  busy = ref(false),
  message = ref("");
let generation = 0,
  disposed = false;
watch(busy, (value) => emit("pending", value), { flush: "sync" });
defineExpose({ pending: busy });
watch(
  () => [
    props.node?.id,
    props.node?.smiles,
    props.node?.label,
    props.node?.note,
    props.contextId,
  ],
  () => {
    generation++;
    busy.value = false;
    label.value = props.node?.label || "";
    smiles.value = props.node?.smiles || "";
    note.value = props.node?.note || "";
    message.value = "";
  },
  { immediate: true, flush: "sync" },
);
watch(
  () => props.editable,
  () => {
    generation++;
    busy.value = false;
    message.value = "";
  },
  { flush: "sync" },
);
async function apply() {
  if (
    !props.node ||
    !props.editable ||
    busy.value ||
    structureInput.value?.pending
  )
    return;
  const current = ++generation;
  const node = { ...props.node };
  const draft = { label: label.value, smiles: smiles.value, note: note.value };
  busy.value = true;
  message.value = "";
  try {
    let canonical = "";
    if (node.type === "molecule") {
      const value = await API.post("/api/v1/structure/validate", {
        smiles: draft.smiles,
      });
      if (typeof value?.smiles !== "string" || !value.smiles.trim())
        throw new Error(JSON.stringify({ detail: "结构校验未返回有效结构。" }));
      canonical = value.smiles;
    }
    if (
      disposed ||
      current !== generation ||
      node.id !== props.node?.id ||
      !props.editable
    )
      return;
    if (
      draft.smiles !== smiles.value ||
      draft.label !== label.value ||
      draft.note !== note.value
    ) {
      message.value = "输入内容已变化，请重新应用修改。";
      return;
    }
    emit("update", {
      ...node,
      label: draft.label,
      smiles: canonical,
      note: draft.note,
    });
  } catch (e) {
    if (!disposed && current === generation)
      message.value = errorMessage(e, "结构或反应信息修改无效。");
  } finally {
    if (!disposed && current === generation) busy.value = false;
  }
}
onBeforeUnmount(() => {
  disposed = true;
  generation++;
  busy.value = false;
});
</script>
<style scoped>
.route-inspector {
  width: 340px;
  flex-shrink: 0;
  max-width: 100%;
  border-left: 1px solid var(--ws-border);
  background: var(--ws-surface);
  padding: 18px;
  overflow-y: auto;
}
.inspector-smiles summary {
  cursor: pointer;
  font-size: 12px;
  color: var(--ws-muted);
}
.inspector-smiles code,
.inspector-readonly {
  display: block;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.inspector-smiles code {
  margin-top: 8px;
  font-size: 12px;
}
.route-inspector header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  font-size: 13px;
}
.inspector-empty {
  display: grid;
  place-items: center;
  height: 180px;
  color: var(--ws-muted);
}
@media (max-width: 1000px) {
  .route-inspector {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 15;
    box-shadow: -8px 0 30px #0001;
    width: min(340px, 100%);
  }
}
</style>
