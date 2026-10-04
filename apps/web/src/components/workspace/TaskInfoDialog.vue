<template>
  <v-dialog v-model="open" max-width="860" aria-labelledby="task-info-title">
    <article class="task-info-dialog">
      <header class="task-info-heading">
        <div>
          <h2 id="task-info-title">任务信息</h2>
          <p v-if="task" :title="taskTitle(task)">{{ taskTitle(task) }}</p>
        </div>
        <v-tooltip
          v-if="task && !task.archived && !renameForm"
          text="重命名任务"
        >
          <template #activator="{ props }">
            <v-btn
              v-bind="props"
              icon="mdi-pencil-outline"
              variant="text"
              size="small"
              aria-label="重命名任务"
              :disabled="loading || busy"
              @click="$emit('rename')"
            />
          </template>
        </v-tooltip>
        <v-tooltip text="关闭任务信息">
          <template #activator="{ props }">
            <v-btn
              v-bind="props"
              icon="mdi-close"
              variant="text"
              size="small"
              aria-label="关闭任务信息"
              @click="open = false"
            />
          </template>
        </v-tooltip>
      </header>
      <v-progress-linear
        v-if="loading"
        indeterminate
        aria-label="读取任务参数"
      />
      <div v-if="task" class="task-info-body" :aria-busy="loading">
        <form
          v-if="renameForm?.id === task.result_id"
          class="task-name-form"
          @submit.prevent="$emit('save-name')"
        >
          <v-text-field
            :model-value="renameForm.description"
            density="compact"
            variant="outlined"
            label="任务名称"
            aria-label="任务名称"
            maxlength="256"
            hide-details
            autofocus
            :disabled="busy"
            @update:model-value="$emit('name', $event || '')"
          />
          <v-tooltip text="保存名称">
            <template #activator="{ props }">
              <v-btn
                v-bind="props"
                type="submit"
                icon="mdi-check"
                variant="text"
                aria-label="保存名称"
                :disabled="loading || busy || !renameForm.description.trim()"
                :loading="renaming"
              />
            </template>
          </v-tooltip>
          <v-tooltip text="取消重命名">
            <template #activator="{ props }">
              <v-btn
                v-bind="props"
                icon="mdi-close"
                variant="text"
                aria-label="取消重命名"
                :disabled="busy"
                @click="$emit('cancel-name')"
              />
            </template>
          </v-tooltip>
          <div
            v-if="renameError"
            class="task-name-error tool-error"
            role="alert"
          >
            {{ renameError }}
          </div>
        </form>
        <div class="task-info-summary">
          <div class="task-info-structure">
            <SmilesImage
              :smiles="task.target_smiles"
              width="100%"
              height="100%"
              :show-error-image="false"
            />
          </div>
          <dl class="task-info-metadata">
            <div>
              <dt>任务状态</dt>
              <dd>
                <span
                  class="state-badge"
                  :class="taskStateClass(task.result_state)"
                  >{{ taskStateLabel(task.result_state) }}</span
                >
              </dd>
            </div>
            <div>
              <dt>路线数量</dt>
              <dd>{{ count === null ? "未记录" : count }}</dd>
            </div>
            <div>
              <dt>任务分组</dt>
              <dd>{{ groupName }}</dd>
            </div>
            <div>
              <dt>任务 ID</dt>
              <dd class="workspace-code">{{ task.result_id }}</dd>
            </div>
            <div>
              <dt>创建时间</dt>
              <dd>
                <time :datetime="task.created">{{
                  taskTimestampLabel(task.created)
                }}</time>
              </dd>
            </div>
            <div v-if="task.started_at">
              <dt>开始时间</dt>
              <dd>
                <time :datetime="task.started_at">{{
                  taskTimestampLabel(task.started_at)
                }}</time>
              </dd>
            </div>
            <div v-if="endedAt">
              <dt>结束时间</dt>
              <dd>
                <time :datetime="endedAt">{{
                  taskTimestampLabel(endedAt)
                }}</time>
              </dd>
            </div>
            <div v-else>
              <dt>更新时间</dt>
              <dd>
                <time :datetime="task.modified">{{
                  taskTimestampLabel(task.modified)
                }}</time>
              </dd>
            </div>
            <div v-if="task.error_code">
              <dt>错误代码</dt>
              <dd class="workspace-code">{{ task.error_code }}</dd>
            </div>
          </dl>
        </div>
        <div class="task-info-smiles">
          <span>目标 SMILES</span
          ><code>{{ task.target_smiles || "未记录" }}</code>
        </div>
        <div v-if="error" class="task-info-error" role="alert">
          <span>{{ error }}</span>
          <v-btn
            variant="text"
            size="small"
            prepend-icon="mdi-refresh"
            :disabled="loading || busy"
            @click="$emit('retry')"
            >重试</v-btn
          >
        </div>
        <div
          v-if="loading && !groups.length"
          class="task-info-loading"
          role="status"
        >
          正在读取搜索参数
        </div>
        <section
          v-for="group in groups"
          :key="group.title"
          class="task-info-parameters"
        >
          <h3>{{ group.title }}</h3>
          <dl>
            <div v-for="field in group.fields" :key="field.key">
              <dt>{{ field.label }}</dt>
              <dd>{{ field.value }}</dd>
            </div>
          </dl>
        </section>
        <details v-if="hasSettings" class="task-info-raw">
          <summary>原始请求参数</summary>
          <pre>{{ JSON.stringify(task.settings, null, 2) }}</pre>
        </details>
      </div>
      <footer v-if="task" class="task-info-footer">
        <v-btn
          variant="text"
          prepend-icon="mdi-arrow-top-right"
          :to="taskDetailLocation(task, historyContext)"
          >路线结果</v-btn
        >
        <div>
          <v-btn
            variant="text"
            :prepend-icon="
              progressOnly ? 'mdi-progress-clock' : 'mdi-eye-outline'
            "
            :disabled="loading || busy || !canPreview"
            :aria-label="progressOnly ? '任务进度' : '预览路线'"
            @click="$emit('preview')"
            >{{ progressOnly ? "任务进度" : "预览路线" }}</v-btn
          >
          <v-btn
            color="primary"
            variant="flat"
            prepend-icon="mdi-magnify"
            :disabled="loading || busy || !hasSettings"
            :loading="rerunning"
            aria-label="重新搜索"
            @click="$emit('rerun')"
            >重新搜索</v-btn
          >
        </div>
      </footer>
    </article>
  </v-dialog>
</template>

<script setup>
import { computed } from "vue";
import SmilesImage from "@/components/SmilesImage.vue";
import {
  activeTaskStates,
  taskStateClass,
  taskStateLabel,
} from "@/common/task-state";
import {
  taskDetailLocation,
  taskEndedAt,
  taskParameterGroups,
  taskRouteCount,
  taskTimestampLabel,
  taskTitle,
} from "@/common/task-history-view";
const open = defineModel({ type: Boolean, default: false });
const props = defineProps({
  task: { type: Object, default: null },
  loading: Boolean,
  busy: Boolean,
  rerunning: Boolean,
  error: { type: String, default: "" },
  renameForm: { type: Object, default: null },
  renameError: { type: String, default: "" },
  renaming: Boolean,
  groupName: { type: String, default: "未分组" },
  historyContext: { type: Object, default: null },
});
defineEmits([
  "retry",
  "preview",
  "rerun",
  "rename",
  "name",
  "save-name",
  "cancel-name",
]);
const count = computed(() => taskRouteCount(props.task));
const active = computed(() =>
  activeTaskStates.includes(props.task?.result_state),
);
const canPreview = computed(() => count.value > 0 || active.value);
const progressOnly = computed(() => active.value && !(count.value > 0));
const endedAt = computed(() => taskEndedAt(props.task));
const groups = computed(() => taskParameterGroups(props.task?.settings));
const hasSettings = computed(() =>
  Boolean(props.task?.settings && Object.keys(props.task.settings).length),
);
</script>

<style scoped>
.task-info-dialog {
  display: flex;
  flex-direction: column;
  max-height: calc(100dvh - 48px);
  background: var(--ws-surface);
  color: var(--ws-text);
  border: 1px solid var(--ws-border);
  border-radius: 6px;
  overflow: hidden;
  letter-spacing: 0;
}
.task-info-heading,
.task-info-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 22px;
  flex-shrink: 0;
}
.task-info-heading {
  border-bottom: 1px solid var(--ws-border);
  align-items: flex-start;
}
.task-info-heading > div {
  min-width: 0;
  flex: 1;
}
.task-name-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 36px 36px;
  gap: 4px;
  align-items: center;
  margin-bottom: 18px;
}
.task-name-form :deep(.v-btn) {
  width: 36px;
  height: 36px;
  min-width: 36px;
}
.task-name-error {
  grid-column: 1 / -1;
  overflow-wrap: anywhere;
}
.task-info-heading h2 {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
}
.task-info-heading p {
  font-size: 13px;
  margin: 5px 0 0;
  overflow-wrap: anywhere;
  color: var(--ws-muted);
  line-height: 20px;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}
.task-info-body {
  padding: 20px 22px;
  overflow: auto;
  max-height: 68dvh;
  min-height: 0;
}
.task-info-summary {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr);
  gap: 24px;
  align-items: center;
}
.task-info-structure {
  height: 220px;
  min-width: 0;
  overflow: hidden;
}
.task-info-structure :deep(.smiles-image-container) {
  height: 100%;
}
.task-info-structure :deep(.structure-error-state span) {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}
.task-info-metadata,
.task-info-parameters dl {
  margin: 0;
  font-size: 12px;
}
.task-info-metadata > div {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  align-items: baseline;
  gap: 10px;
  padding: 6px 0;
}
.task-info-dialog dt {
  color: var(--ws-muted);
  overflow-wrap: anywhere;
}
.task-info-dialog dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.task-info-smiles {
  display: grid;
  gap: 8px;
  font-size: 12px;
  margin: 16px 0 4px;
}
.task-info-smiles > span {
  color: var(--ws-muted);
}
.task-info-smiles code {
  font-size: 11px;
  overflow-wrap: anywhere;
}
.task-info-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 14px;
  color: #c63f43;
  font-size: 12px;
}
.task-info-error > span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.task-info-loading {
  padding: 20px 0;
  font-size: 12px;
  color: var(--ws-muted);
}
.task-info-parameters {
  border-top: 1px solid var(--ws-border);
  margin-top: 20px;
  padding-top: 16px;
}
.task-info-parameters h3 {
  font-size: 13px;
  font-weight: 500;
  margin: 0 0 10px;
}
.task-info-parameters dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 28px;
}
.task-info-parameters dl > div {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 10px;
  align-items: baseline;
}
.task-info-raw {
  margin-top: 20px;
  font-size: 12px;
  color: var(--ws-muted);
}
.task-info-raw summary {
  cursor: pointer;
}
.task-info-raw pre {
  font-size: 11px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin-top: 12px;
  color: var(--ws-text);
}
.task-info-footer {
  border-top: 1px solid var(--ws-border);
  flex-wrap: wrap;
}
.task-info-footer > div {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.task-info-dialog :deep(.v-btn) {
  border-radius: 6px;
  font-size: 12px;
  letter-spacing: 0;
  text-transform: none;
}
@media (max-width: 600px) {
  .task-info-heading,
  .task-info-footer {
    padding: 14px;
  }
  .task-info-body {
    padding: 14px;
    max-height: 62dvh;
  }
  .task-info-summary {
    grid-template-columns: 1fr;
    gap: 10px;
  }
  .task-info-structure {
    height: 180px;
  }
  .task-info-parameters dl {
    grid-template-columns: 1fr;
  }
  .task-info-footer {
    gap: 8px;
  }
}
</style>
