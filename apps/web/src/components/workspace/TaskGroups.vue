<template>
  <aside class="task-groups" aria-label="任务分组">
    <header>
      <h2>任务分组</h2>
      <v-tooltip text="新建分组">
        <template #activator="{ props }">
          <v-btn
            v-bind="props"
            icon="mdi-folder-plus-outline"
            variant="text"
            size="small"
            aria-label="新建分组"
            :disabled="busy"
            @click="$emit('create')"
          />
        </template>
      </v-tooltip>
    </header>
    <nav aria-label="任务分组导航" :aria-busy="!countsLoaded">
      <button
        class="group-link"
        :aria-current="!archived && selected === 'all' ? 'page' : undefined"
        @click="$emit('select', 'all')"
      >
        <v-icon icon="mdi-folder-multiple-outline" size="18" /><span
          >全部任务</span
        ><small :aria-hidden="!countsLoaded">{{ countsLoaded ? allTotal : "" }}</small>
      </button>
      <button
        class="group-link"
        :aria-current="
          !archived && selected === 'ungrouped' ? 'page' : undefined
        "
        @click="$emit('select', 'ungrouped')"
      >
        <v-icon icon="mdi-folder-outline" size="18" /><span>未分组</span
        ><small :aria-hidden="!countsLoaded">{{ countsLoaded ? ungroupedTotal : "" }}</small>
      </button>
      <div v-for="group in groups" :key="group.id" class="group-row">
        <button
          class="group-link"
          :aria-current="
            !archived && selected === group.id ? 'page' : undefined
          "
          @click="$emit('select', group.id)"
        >
          <v-icon icon="mdi-folder-outline" size="18" /><span
            :title="group.name"
            >{{ group.name }}</span
          ><small :aria-hidden="!countsLoaded">{{ countsLoaded ? group.count : "" }}</small>
        </button>
        <v-menu :disabled="busy">
          <template #activator="{ props: menuProps }">
            <v-tooltip :text="`分组操作：${group.name}`">
              <template #activator="{ props: tooltipProps }">
                <v-btn v-bind="mergeProps(menuProps, tooltipProps)" icon="mdi-dots-horizontal"
                  variant="text" size="small" :aria-label="`分组操作：${group.name}`" :disabled="busy" />
              </template>
            </v-tooltip>
          </template>
          <v-list density="compact" class="group-actions-menu" role="menu" :aria-label="`分组操作：${group.name}`">
            <v-list-item
              role="menuitem"
              title="重命名分组"
              aria-label="重命名分组"
              :disabled="busy"
              prepend-icon="mdi-pencil-outline"
              @click="$emit('rename', group)"
            />
            <v-list-item
              role="menuitem"
              title="解散分组"
              aria-label="解散分组"
              :disabled="busy"
              prepend-icon="mdi-folder-remove-outline"
              @click="$emit('delete', group)"
            />
          </v-list>
        </v-menu>
      </div>
      <button
        class="group-link recycle-link"
        :aria-current="archived ? 'page' : undefined"
        @click="$emit('archive')"
      >
        <v-icon icon="mdi-delete-restore" size="18" /><span>回收箱</span>
      </button>
    </nav>
    <v-dialog
      :model-value="Boolean(form)"
      max-width="420"
      aria-labelledby="group-form-title"
      @update:model-value="
        (open) => {
          if (!open && !busy) $emit('close');
        }
      "
    >
      <form v-if="form" class="group-form" @submit.prevent="$emit('save')">
        <header>
          <h2 id="group-form-title">
            {{ form.id ? "重命名分组" : "新建分组" }}
          </h2>
          <v-btn
            icon="mdi-close"
            variant="text"
            size="small"
            aria-label="关闭分组表单"
            :disabled="busy"
            @click="$emit('close')"
          />
        </header>
        <v-text-field
          :model-value="form.name"
          label="分组名称"
          aria-label="分组名称"
          maxlength="128"
          density="compact"
          variant="outlined"
          hide-details
          autofocus
          :disabled="busy"
          @update:model-value="$emit('name', $event || '')"
        />
        <div v-if="error" class="tool-error" role="alert">{{ error }}</div>
        <footer>
          <v-btn
            type="submit"
            color="primary"
            variant="flat"
            prepend-icon="mdi-check"
            :loading="busy"
            :disabled="busy || !form.name.trim()"
            >保存</v-btn
          >
        </footer>
      </form>
    </v-dialog>
  </aside>
</template>

<script setup>
import { mergeProps } from "vue";
defineProps({
  groups: { type: Array, default: () => [] },
  selected: { type: String, default: "all" },
  archived: Boolean,
  allTotal: { type: Number, default: 0 },
  ungroupedTotal: { type: Number, default: 0 },
  countsLoaded: { type: Boolean, default: true },
  busy: Boolean,
  form: { type: Object, default: null },
  error: { type: String, default: "" },
});
defineEmits([
  "select",
  "archive",
  "create",
  "rename",
  "delete",
  "save",
  "name",
  "close",
]);
</script>

<style scoped>
.task-groups {
  min-width: 0;
  font-size: 14px;
  letter-spacing: 0;
  border-right: 1px solid var(--ws-border);
  padding-right: 16px;
}
.task-groups header,
.group-form header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.task-groups > header { min-height: 36px; margin-bottom: 12px; }
h2 {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
}
nav {
  display: grid;
  gap: 3px;
}
.group-row {
  display: flex;
  min-width: 0;
  align-items: center;
}
.group-link {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  padding: 9px 7px;
  border-radius: 6px;
  color: var(--ws-text);
  text-align: left;
  font-size: 14px;
  line-height: 20px;
}
.group-link:hover {
  background: var(--ws-muted-surface);
}
.group-link[aria-current] {
  background: var(--ws-accent-soft);
  color: var(--ws-accent);
  font-weight: 600;
}
.group-link:focus-visible { outline: 2px solid var(--ws-accent); outline-offset: 2px; }
.group-link span {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.group-link small {
  color: var(--ws-muted);
  font-size: 12px;
  flex-shrink: 0;
  min-width: 22px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.group-link[aria-current] small { color: inherit; }
.group-row :deep(.v-btn),
.task-groups header :deep(.v-btn) {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  min-width: 32px;
  color: var(--ws-muted);
  border-radius: 6px;
}
.group-actions-menu { min-width: 196px; max-width: calc(100vw - 32px); padding: 4px; border: 1px solid var(--ws-border); border-radius: 8px; background: var(--ws-surface); color: var(--ws-text); }
.group-actions-menu :deep(.v-list-item) { border-radius: 6px; min-height: 36px; }
.group-actions-menu :deep(.v-list-item-title) { font-size: 14px; line-height: 20px; }
.group-actions-menu :deep(.v-list-item:focus-visible) { outline: 2px solid var(--ws-accent); outline-offset: -2px; }
.recycle-link {
  border-top: 1px solid var(--ws-border);
  margin-top: 10px;
  border-radius: 0;
}
.group-form {
  display: grid;
  gap: 14px;
  padding: 20px;
  background: var(--ws-surface);
  color: var(--ws-text);
  border: 1px solid var(--ws-border);
  border-radius: 6px;
  min-width: 0;
  letter-spacing: 0;
}
.group-form footer {
  display: flex;
  justify-content: flex-end;
}
.group-form h2 { font-size: 16px; }
.group-form .tool-error { overflow-wrap: anywhere; }
.group-form :deep(.v-field) { border-radius: 6px; }
.group-form :deep(.v-btn) {
  letter-spacing: 0;
  border-radius: 6px;
}
@media (max-width: 760px) {
  .task-groups {
    border-right: 0;
    border-bottom: 1px solid var(--ws-border);
    padding: 0 0 12px;
  }
  nav {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .recycle-link {
    margin-top: 0;
    border-top: 0;
    border-radius: 6px;
  }
}
</style>
