<template>
  <module-workbench
    :title="$tr('禁用规则')"
    :modules="banModules"
    :active-module="activeModule"
    @select-module="setActiveModule"
  >
      <div class="banlist-toolbar">
        <v-select
          v-model="filterActive"
          :items="localizedFilters"
          item-title="title"
          item-value="key"
          :label="$tr('状态')"
          density="compact"
          variant="outlined"
          hide-details
        />
        <div class="page-actions">
          <v-btn
            color="primary"
            variant="flat"
            prepend-icon="mdi-plus"
            :disabled="!allowed || pendingTasks > 0"
            data-cy="banlist-add-single-entry"
            @click="showBanItemDialog = true"
            >{{ $tr('新增条目') }}</v-btn
          >
          <v-btn
            variant="outlined"
            prepend-icon="mdi-file-import-outline"
            :disabled="!allowed || pendingTasks > 0"
            data-cy="banlist-add-multiple-entries"
            @click="showMultiEntryDialog = true"
            >{{ $tr('批量新增') }}</v-btn
          >
          <v-tooltip :text="$tr('清空全部禁用规则')" location="top">
            <template #activator="{ props }">
              <v-btn
                v-bind="props"
                icon="mdi-delete-sweep-outline"
                :aria-label="$tr('清空全部禁用规则')"
                variant="text"
                :disabled="
                  !allowed || pendingTasks > 0 || (!chemicals.length && !reactions.length)
                "
                data-cy="banlist-reset"
                @click="deleteAll"
              />
            </template>
          </v-tooltip>
        </div>
      </div>
      <p v-if="requestError" class="tool-error" role="alert">
        {{ requestError }}
      </p>
      <v-data-table
        v-if="tabItems.length || pendingTasks > 0"
        :headers="localizedHeaders"
        :items="tabItems"
        :items-per-page="10"
        :loading="pendingTasks > 0"
        density="comfortable"
        data-cy="banlist-table"
        :no-data-text="$tr('暂无符合筛选的条目')"
        :loading-text="$tr('正在加载规则')"
      >
        <template #item.active="{ item }">
          <v-switch
            :model-value="item.active"
            color="primary"
            hide-details
            density="compact"
            :aria-label="item.active ? $tr('停用规则') : $tr('启用规则')"
            :disabled="!allowed || pendingTasks > 0"
            @update:model-value="toggleActivation(item, activeModule)"
          />
        </template>
        <template #item.smiles="{ item }">
          <copy-tooltip :data="item.smiles"
            ><smiles-image :smiles="item.smiles" :show-error-image="false"
          /></copy-tooltip>
        </template>
        <template #item.created="{ item }">{{ createdText(item.created) }}</template>
        <template #item.delete="{ item }">
          <v-tooltip :text="$tr('删除规则')" location="top">
            <template #activator="{ props }">
              <v-btn
                v-bind="props"
                icon="mdi-delete-outline"
                :aria-label="$tr('删除规则')"
                variant="text"
                size="small"
                :disabled="!allowed || pendingTasks > 0"
                data-cy="banlist-single-delete"
                @click="deleteEntry(item.id, activeModule)"
              />
            </template>
          </v-tooltip>
        </template>
      </v-data-table>
      <div v-else class="workspace-empty">
        <v-icon icon="mdi-shield-outline" size="28" />
        <h2>
          {{ filterActive === "all" ? $tr('暂无禁用条目') : $tr('暂无符合筛选的条目') }}
        </h2>
      </div>
      <ban-item-dialog
        :key="`single:${ownerEpoch}`"
        v-model:showBanItemDialog="showBanItemDialog"
        v-model:activeTab="activeTab"
        @loadCollection="loadCollection"
      />
      <multi-entry-dialog
        :key="`multiple:${ownerEpoch}`"
        v-model:showMultiEntryDialog="showMultiEntryDialog"
        @loadCollection="loadCollection"
      />
  </module-workbench>
</template>

<script setup>
import { computed, onMounted } from "vue";
import { useConfirm } from "vuetify-use-dialog";
import SmilesImage from "@/components/SmilesImage";
import CopyTooltip from "@/components/CopyTooltip";
import BanItemDialog from "@/components/banlist/BanItemDialog";
import MultiEntryDialog from "@/components/banlist/MultiEntryDialog";
import ModuleWorkbench from "@/components/ModuleWorkbench.vue";
import { useWorkspaceStore } from "@/store/workspace";
import { formatUiDate, uiText } from "@/i18n";
import { useBanlist } from "./useBanlist";

const workspace = useWorkspaceStore();
const confirm = useConfirm();
const { activeTab, chemicals, reactions, showBanItemDialog, showMultiEntryDialog,
  filterActive, pendingTasks, requestError, allowed, ownerEpoch,
  loadCollection, deleteEntry, deleteAll, toggleActivation } = useBanlist({ workspace, confirm });
const banModules = computed(() =>
  [
    {
      value: "chemicals",
      title: uiText("化学品"),
      disabled: !allowed.value,
    },
    {
      value: "reactions",
      title: uiText("反应"),
      disabled: !allowed.value,
    },
  ],
);
const filterOptions = [
  { key: "all", title: "全部" },
  { key: "active", title: "已启用" },
  { key: "inactive", title: "已停用" },
];
const localizedFilters = computed(() => filterOptions.map((item) => ({ ...item, title: uiText(item.title) })));
const activeModule = computed(() =>
  activeTab.value === 0 ? "chemicals" : "reactions",
);
const setActiveModule = (value) => {
  if (["chemicals", "reactions"].includes(value))
    activeTab.value = value === "reactions" ? 1 : 0;
};
const headers = computed(() => [
  { key: "active", title: "启用" },
  { key: "created", title: "创建时间" },
  { key: "smiles", title: activeTab.value === 0 ? "化学品" : "反应" },
  { key: "description", title: "描述" },
  { key: "delete", title: "", sortable: false },
]);
const localizedHeaders = computed(() => headers.value.map((item) => ({ ...item, title: uiText(item.title) })));
const createdText = (value) => value && !Number.isNaN(new Date(value).getTime()) ? formatUiDate(value) : uiText("暂无记录");
const tabItems = computed(() => {
  const items = activeTab.value === 0 ? chemicals.value : reactions.value;
  if (filterActive.value === "active")
    return items.filter((item) => item.active === true);
  if (filterActive.value === "inactive")
    return items.filter((item) => item.active === false);
  return items;
});

onMounted(() => workspace.refresh());
</script>

<style scoped>
.banlist-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 24px;
}
.banlist-toolbar :deep(.v-select) {
  max-width: 220px;
}
@media (max-width: 600px) {
  .banlist-toolbar :deep(.v-select) {
    flex-basis: 100%;
    max-width: none;
  }
}
</style>
