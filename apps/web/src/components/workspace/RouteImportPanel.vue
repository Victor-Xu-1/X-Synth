<template>
  <section class="route-import-panel" aria-label="导入路线文档">
    <input
      ref="input"
      type="file"
      accept=".json,application/json"
      hidden
      @change="importFile"
    />
    <div
      class="route-file-area"
      :class="{ 'file-dragging': dragging }"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="drop"
    >
      <v-icon icon="mdi-file-document-outline" size="40" />
      <h2>X-Synth 路线文档</h2>
      <span>JSON · 最大 10 MB</span
      ><v-btn
        color="primary"
        variant="flat"
        prepend-icon="mdi-folder-open-outline"
        :loading="busy"
        @click="input.click()"
        >选择文件</v-btn
      >
    </div>
    <div v-if="error" class="tool-error" role="alert">{{ error }}</div>
  </section>
</template>
<script setup>
import { onBeforeUnmount, ref } from "vue";
import { useRouter } from "vue-router";
import { API } from "@/common/api";
import { importRouteDocument } from "@/common/route-document-file";
import { errorMessage } from "@/common/workspace-errors";
const router = useRouter();
const input = ref(null),
  busy = ref(false),
  error = ref(""),
  dragging = ref(false);
let alive = true;
async function run(file) {
  if (!file || busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    const document = await importRouteDocument(API, file);
    if (alive) await router.push(`/editor/${document.id}`);
  } catch (e) {
    if (alive) error.value = errorMessage(e, "路线文件导入失败。");
  } finally {
    if (alive) busy.value = false;
  }
}
function importFile(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  run(file);
}
function drop(event) {
  dragging.value = false;
  run(event.dataTransfer.files?.[0]);
}
onBeforeUnmount(() => (alive = false));
</script>
<style scoped>
.route-import-panel {
  max-width: 700px;
  margin: 30px auto;
}
.route-file-area {
  border: 1px dashed var(--ws-border);
  border-radius: 7px;
  min-height: 360px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  color: var(--ws-muted);
  padding: 24px;
}
.route-file-area h2 {
  font-size: 18px;
  font-weight: 550;
  color: var(--ws-text);
  text-align: center;
}
.route-file-area span {
  font-size: 12px;
}
.file-dragging {
  background: var(--ws-hover);
}
.tool-error {
  margin-top: 16px;
}
</style>
