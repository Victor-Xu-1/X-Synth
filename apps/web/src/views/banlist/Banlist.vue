<template>
  <module-workbench
    title="禁用规则"
    :modules="banModules"
    :active-module="activeModule"
    @select-module="setActiveModule"
  >
    <div v-if="workspace.loading" class="workspace-loading">
      <v-progress-linear indeterminate />
    </div>
    <div v-else-if="!workspace.can('native_account')" class="workspace-empty">
      <v-icon icon="mdi-server-off" size="32" />
      <h2>当前工作区未启用禁用规则服务</h2>
      <router-link to="/environments?tab=monitor">查看运行监测</router-link>
    </div>
    <template v-else>
      <div class="banlist-toolbar">
        <v-select
          v-model="filterActive"
          :items="filterOptions"
          item-title="title"
          item-value="key"
          label="状态"
          density="compact"
          variant="outlined"
          hide-details
        />
        <div class="page-actions">
          <v-btn
            color="primary"
            variant="flat"
            prepend-icon="mdi-plus"
            :disabled="pendingTasks > 0"
            data-cy="banlist-add-single-entry"
            @click="showBanItemDialog = true"
            >新增条目</v-btn
          >
          <v-btn
            variant="outlined"
            prepend-icon="mdi-file-import-outline"
            :disabled="pendingTasks > 0"
            data-cy="banlist-add-multiple-entries"
            @click="showMultiEntryDialog = true"
            >批量新增</v-btn
          >
          <v-tooltip text="清空全部禁用规则" location="top">
            <template #activator="{ props }">
              <v-btn
                v-bind="props"
                icon="mdi-delete-sweep-outline"
                aria-label="清空全部禁用规则"
                variant="text"
                :disabled="
                  pendingTasks > 0 || (!chemicals.length && !reactions.length)
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
        :headers="headers"
        :items="tabItems"
        :items-per-page="10"
        :loading="pendingTasks > 0"
        density="comfortable"
        data-cy="banlist-table"
        no-data-text="暂无符合筛选的条目"
        loading-text="正在加载规则"
      >
        <template #item.active="{ item }">
          <v-switch
            :model-value="item.active"
            color="primary"
            hide-details
            density="compact"
            :aria-label="item.active ? '停用规则' : '启用规则'"
            :disabled="pendingTasks > 0"
            @update:model-value="toggleActivation(item, activeModule)"
          />
        </template>
        <template #item.smiles="{ item }">
          <copy-tooltip :data="item.smiles"
            ><smiles-image :smiles="item.smiles" :show-error-image="false"
          /></copy-tooltip>
        </template>
        <template #item.delete="{ item }">
          <v-tooltip text="删除规则" location="top">
            <template #activator="{ props }">
              <v-btn
                v-bind="props"
                icon="mdi-delete-outline"
                aria-label="删除规则"
                variant="text"
                size="small"
                :disabled="pendingTasks > 0"
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
          {{ filterActive === "all" ? "暂无禁用条目" : "暂无符合筛选的条目" }}
        </h2>
      </div>
      <ban-item-dialog
        v-model:showBanItemDialog="showBanItemDialog"
        v-model:pendingTasks="pendingTasks"
        v-model:activeTab="activeTab"
        @loadCollection="loadCollection"
      />
      <multi-entry-dialog
        v-model:showMultiEntryDialog="showMultiEntryDialog"
        v-model:pendingTasks="pendingTasks"
        @loadCollection="loadCollection"
      />
    </template>
  </module-workbench>
</template>

<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useConfirm } from "vuetify-use-dialog";
import SmilesImage from "@/components/SmilesImage";
import CopyTooltip from "@/components/CopyTooltip";
import { API } from "@/common/api";
import BanItemDialog from "@/components/banlist/BanItemDialog";
import MultiEntryDialog from "@/components/banlist/MultiEntryDialog";
import ModuleWorkbench from "@/components/ModuleWorkbench.vue";
import { useWorkspaceStore } from "@/store/workspace";

const workspace = useWorkspaceStore();
const confirm = useConfirm();
const activeTab = ref(0);
const chemicals = ref([]);
const reactions = ref([]);
const showBanItemDialog = ref(false);
const showMultiEntryDialog = ref(false);
const filterActive = ref("all");
const pendingTasks = ref(0);
const requestError = ref("");
const banModules = computed(() =>
  [
    {
      value: "chemicals",
      title: "化学品",
      disabled: !workspace.can("native_account"),
    },
    {
      value: "reactions",
      title: "反应",
      disabled: !workspace.can("native_account"),
    },
  ].filter((module) => !module.disabled),
);
const filterOptions = [
  { key: "all", title: "全部" },
  { key: "active", title: "已启用" },
  { key: "inactive", title: "已停用" },
];
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
const tabItems = computed(() => {
  const items = activeTab.value === 0 ? chemicals.value : reactions.value;
  if (filterActive.value === "active")
    return items.filter((item) => item.active === true);
  if (filterActive.value === "inactive")
    return items.filter((item) => item.active === false);
  return items;
});

const loadCollection = async (category) => {
  if (
    !workspace.can("native_account") ||
    !["chemicals", "reactions"].includes(category)
  )
    return;
  pendingTasks.value++;
  try {
    const response = await API.get(`/api/banlist/${category}/get`, null, false);
    if (!Array.isArray(response)) throw new Error("Invalid banlist response");
    const items = response.map((item) => {
      const created = new Date(item.created);
      return {
        ...item,
        created:
          item.created && !Number.isNaN(created.getTime())
            ? created.toLocaleString("zh-CN")
            : "暂无记录",
      };
    });
    if (category === "chemicals") chemicals.value = items;
    else reactions.value = items;
  } catch {
    requestError.value = "规则加载失败，请检查身份权限与后端服务状态。";
  } finally {
    pendingTasks.value--;
  }
};

const deleteEntry = async (id, category) => {
  if (pendingTasks.value > 0 || !workspace.can("native_account")) return;
  pendingTasks.value++;
  requestError.value = "";
  try {
    const accepted = await confirm({
      title: "删除规则",
      content: "确定删除此条禁用规则？",
      dialogProps: { width: 420 },
    });
    if (!accepted) return;
    await API.delete(
      `/api/banlist/${category}/delete?_id=${encodeURIComponent(id)}`,
    );
    await loadCollection(category);
  } catch {
    requestError.value = "删除失败，请检查身份权限与后端服务状态。";
  } finally {
    pendingTasks.value--;
  }
};

const deleteAll = async () => {
  if (pendingTasks.value > 0 || !workspace.can("native_account")) return;
  pendingTasks.value++;
  requestError.value = "";
  try {
    const accepted = await confirm({
      title: "清空全部规则",
      content: "确定删除全部化学品与反应禁用规则？此操作无法撤销。",
      dialogProps: { width: 440 },
    });
    if (!accepted) return;
    const failed = [];
    for (const [category, items] of [
      ["chemicals", chemicals.value],
      ["reactions", reactions.value],
    ]) {
      for (const item of items) {
        try {
          await API.delete(
            `/api/banlist/${category}/delete?_id=${encodeURIComponent(item.id)}`,
          );
        } catch {
          failed.push(item.id);
        }
      }
    }
    await Promise.all([
      loadCollection("chemicals"),
      loadCollection("reactions"),
    ]);
    if (failed.length)
      requestError.value = `有 ${failed.length} 条规则删除失败，请刷新后重试。`;
  } catch {
    requestError.value = "无法清空规则，请检查后端服务状态。";
  } finally {
    pendingTasks.value--;
  }
};

const toggleActivation = async (item, category) => {
  if (pendingTasks.value > 0 || !workspace.can("native_account")) return;
  pendingTasks.value++;
  requestError.value = "";
  try {
    await API.get(
      `/api/banlist/${category}/${item.active ? "deactivate" : "activate"}`,
      { _id: item.id },
    );
    await loadCollection(category);
  } catch {
    requestError.value = "规则状态更新失败，请检查身份权限与后端服务状态。";
  } finally {
    pendingTasks.value--;
  }
};

watch(
  () => workspace.can("native_account"),
  (enabled) => {
    if (enabled) {
      requestError.value = "";
      loadCollection("chemicals");
      loadCollection("reactions");
    }
  },
  { immediate: true },
);
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
