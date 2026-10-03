<template>
  <aside class="route-inspector" aria-label="节点详情">
    <header>
      <strong>{{
        node ? (node.type === "molecule" ? "分子节点" : "反应节点") : "节点详情"
      }}</strong
      ><v-btn
        icon="mdi-close"
        size="x-small"
        variant="text"
        aria-label="关闭详情"
        @click="$emit('close')"
      />
    </header>
    <div v-if="!node" class="inspector-empty">
      <v-icon icon="mdi-cursor-default-outline" size="24" />
    </div>
    <div v-else class="tool-fields">
      <SmilesImage
        v-if="node.type === 'molecule'"
        :smiles="node.smiles"
        :width="260"
        :height="150"
        :show-error-image="false"
      />
      <label
        ><span class="field-label">名称</span
        ><input
          class="workspace-input"
          v-model="label"
          maxlength="120"
          :readonly="!editable"
      /></label>
      <label v-if="node.type === 'molecule'"
        ><span class="field-label">SMILES</span
        ><textarea
          class="workspace-input workspace-code"
          v-model="smiles"
          rows="4"
          :readonly="!editable"
        />
      </label>
      <v-btn
        v-if="editable && node.type === 'molecule'"
        prepend-icon="mdi-draw"
        variant="outlined"
        @click="drawing = true"
        >绘制结构</v-btn
      >
      <label
        ><span class="field-label">备注</span
        ><textarea
          class="workspace-input"
          v-model="note"
          rows="5"
          maxlength="4096"
          :readonly="!editable"
        />
      </label>
      <div v-if="typeof score === 'number'" class="workspace-muted">
        模型分数 {{ score.toFixed(3) }}
      </div>
      <div v-if="message" class="tool-error" role="alert">{{ message }}</div>
      <v-btn
        v-if="editable"
        variant="flat"
        color="primary"
        :loading="busy"
        @click="apply"
        >应用修改</v-btn
      >
      <v-btn
        v-if="editable && !target"
        prepend-icon="mdi-trash-can-outline"
        variant="text"
        color="error"
        @click="$emit('remove')"
        >删除节点</v-btn
      >
    </div>
    <KetcherModal
      v-model:smiles="smiles"
      :value="drawing"
      @input="drawing = $event"
    />
  </aside>
</template>
<script setup>
import { ref, watch } from "vue";
import SmilesImage from "@/components/SmilesImage.vue";
import KetcherModal from "@/components/KetcherModal.vue";
import { API } from "@/common/api";
import { errorMessage } from "@/common/workspace-errors";
const props = defineProps({
  node: Object,
  editable: Boolean,
  target: Boolean,
  score: Number,
});
const emit = defineEmits(["update", "close", "remove"]);
const label = ref(""),
  smiles = ref(""),
  note = ref(""),
  busy = ref(false),
  message = ref(""),
  drawing = ref(false);
watch(
  () => [
    props.node?.id,
    props.node?.smiles,
    props.node?.label,
    props.node?.note,
  ],
  () => {
    label.value = props.node?.label || "";
    smiles.value = props.node?.smiles || "";
    note.value = props.node?.note || "";
    message.value = "";
  },
  { immediate: true },
);
async function apply() {
  busy.value = true;
  message.value = "";
  try {
    let canonical = "";
    if (props.node.type === "molecule")
      canonical = (
        await API.post("/api/v1/structure/validate", { smiles: smiles.value })
      ).smiles;
    emit("update", {
      ...props.node,
      label: label.value,
      smiles: canonical,
      note: note.value,
    });
  } catch (e) {
    message.value = errorMessage(e, "节点修改无效。");
  } finally {
    busy.value = false;
  }
}
</script>
<style scoped>
.route-inspector {
  width: 300px;
  border-left: 1px solid var(--ws-border);
  background: var(--ws-surface);
  padding: 18px;
  overflow-y: auto;
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
    width: min(300px, 100%);
  }
}
</style>
