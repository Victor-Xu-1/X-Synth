<template>
  <module-workbench title="账号管理">
    <template #actions>
      <v-btn
        v-if="allowed"
        variant="text"
        prepend-icon="mdi-refresh"
        :loading="dataLoading"
        :disabled="busy"
        @click="fetchData"
        >刷新</v-btn
      >
    </template>
    <div v-if="workspace.loading && !workspace.session && !workspace.refreshed" class="workspace-loading" role="status">
      <v-progress-linear indeterminate />
    </div>
    <div v-else-if="!allowed" class="workspace-empty">
      <v-icon icon="mdi-account-off-outline" size="32" />
      <h2>当前工作区未启用账号服务</h2>
      <router-link to="/">返回工作区</router-link>
    </div>
    <template v-else>
      <p v-if="dataError" class="tool-error" role="alert">{{ dataError }}</p>
      <p v-if="notice" class="workspace-muted mb-4" role="status">
        {{ notice }}
      </p>
      <v-progress-linear v-if="dataLoading" indeterminate color="primary" />
      <template v-if="currentUser">
        <template v-if="isAdmin">
          <div class="account-toolbar">
            <v-select
              v-model="filterSelected"
              label="账号类型"
              :items="filterOptions"
              item-title="title"
              item-value="key"
              variant="outlined"
              density="compact"
              hide-details
              clearable
              data-cy="admin-user-table-filter-by-account-type"
            />
            <v-checkbox
              v-model="filterInactive"
              label="30 天未登录"
              hide-details
              density="compact"
              data-cy="admin-user-table-show-older-30days"
            />
            <div class="page-actions">
              <v-menu v-if="selection.length">
                <template #activator="{ props }">
                  <v-btn
                    v-bind="props"
                    variant="outlined"
                    append-icon="mdi-chevron-down"
                    :disabled="busy"
                  >
                    已选 {{ selection.length }} 项
                  </v-btn>
                </template>
                <v-list density="compact">
                  <v-list-item
                    v-for="action in bulkActions"
                    :key="action.value"
                    :title="action.title"
                    :prepend-icon="action.icon"
                    :data-cy="action.cy"
                    @click="applyAction(selection, action.value)"
                  />
                </v-list>
              </v-menu>
              <v-btn
                color="primary"
                variant="flat"
                prepend-icon="mdi-plus"
                :disabled="busy"
                @click="openEditor('new')"
                >新建用户</v-btn
              >
            </div>
          </div>
          <v-data-table
            v-model="selection"
            :headers="headers"
            :items="tableItems"
            item-value="username"
            show-select
            :loading="saving"
            density="comfortable"
            :items-per-page="10"
            data-cy="admin-user-table"
            no-data-text="暂无账号"
            loading-text="正在加载账号"
          >
            <template #item.accountType="{ item }"
              ><span class="state-badge">{{
                accountLabels[item.accountType]
              }}</span></template
            >
            <template #item.disabled="{ item }"
              ><span class="state-badge" :class="{ error: item.disabled }">{{
                item.disabled ? "已锁定" : "正常"
              }}</span></template
            >
            <template #item.last_login="{ item }">{{
              formatDate(item.last_login)
            }}</template>
            <template #item.actions="{ item }">
              <v-menu>
                <template #activator="{ props }">
                  <v-btn
                    v-bind="props"
                    icon="mdi-dots-horizontal"
                    variant="text"
                    size="small"
                    :aria-label="'管理账号 ' + item.username"
                    :title="'管理账号 ' + item.username"
                    :disabled="busy || selection.length > 0"
                  />
                </template>
                <v-list density="compact">
                  <v-list-item
                    v-if="item.accountType === 'Normal'"
                    title="设为管理员"
                    prepend-icon="mdi-shield-account-outline"
                    data-cy="admin-user-single-make-admin"
                    @click="applyAction([item.username], 'admin')"
                  />
                  <v-list-item
                    v-if="item.accountType === 'Admin'"
                    title="设为普通用户"
                    prepend-icon="mdi-account-outline"
                    data-cy="admin-user-single-make-normal"
                    @click="applyAction([item.username], 'normal')"
                  />
                  <v-list-item
                    :title="item.disabled ? '解锁账号' : '锁定账号'"
                    prepend-icon="mdi-lock-outline"
                    :data-cy="
                      item.disabled
                        ? 'admin-user-single-unlock-selected'
                        : 'admin-user-single-lock-selected'
                    "
                    @click="
                      applyAction(
                        [item.username],
                        item.disabled ? 'enable' : 'disable',
                      )
                    "
                  />
                  <v-list-item
                    v-if="item.accountType !== 'Guest'"
                    title="修改密码"
                    prepend-icon="mdi-key-outline"
                    data-cy="admin-user-single-change-password"
                    @click="openEditor('password', item)"
                  />
                  <v-list-item
                    v-if="item.accountType !== 'Guest'"
                    title="修改邮箱"
                    prepend-icon="mdi-email-outline"
                    data-cy="admin-user-single-change-email"
                    @click="openEditor('email', item)"
                  />
                  <v-list-item
                    title="删除账号"
                    prepend-icon="mdi-delete-outline"
                    class="text-error"
                    data-cy="admin-user-single-delete-account"
                    @click="applyAction([item.username], 'delete')"
                  />
                </v-list>
              </v-menu>
            </template>
          </v-data-table>
        </template>
        <section v-else class="account-profile">
          <h2 class="tool-section-title">个人资料</h2>
          <dl>
            <dt>用户名</dt>
            <dd>{{ currentUser.username }}</dd>
            <dt>邮箱</dt>
            <dd data-cy="admin-get-email-address-normal-user">
              {{ currentUser.email || "未设置" }}
            </dd>
            <dt>上次登录</dt>
            <dd :title="formatDate(currentUser.last_login)">
              <timeago
                v-if="currentUser.last_login"
                :datetime="currentUser.last_login"
                :converter-options="{
                  includeSeconds: true,
                  addSuffix: false,
                  useStrict: false,
                }"
                auto-update
              />
              <span v-else>暂无记录</span>
            </dd>
          </dl>
          <div class="page-actions">
            <v-btn
              variant="outlined"
              prepend-icon="mdi-email-outline"
              :disabled="busy"
              data-cy="admin-change-email-normal-user"
              @click="openEditor('email', currentUser)"
              >修改邮箱</v-btn
            >
            <v-btn
              variant="outlined"
              prepend-icon="mdi-key-outline"
              :disabled="busy"
              data-cy="admin-change-password-normal-user"
              @click="openEditor('password', currentUser)"
              >修改密码</v-btn
            >
          </div>
          <section class="account-danger">
            <h2 class="tool-section-title">删除账号</h2>
            <p class="workspace-muted mb-3">此操作无法撤销。</p>
            <v-btn
              color="error"
              variant="outlined"
              prepend-icon="mdi-delete-outline"
              :disabled="busy"
              data-cy="admin-delete-normal-user"
              @click="applyAction([currentUser.username], 'delete')"
              >删除账号</v-btn
            >
          </section>
        </section>
      </template>
    </template>
    <account-user-dialog
      v-if="allowed"
      v-model="editorOpen"
      :context-key="contextKey"
      :mode="editorMode"
      :username="selectedUser?.username || ''"
      :initial-email="selectedUser?.email || ''"
      :loading="saving"
      :error="editorError"
      @save="submitEditor"
    />
  </module-workbench>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useConfirm } from "vuetify-use-dialog";
import ModuleWorkbench from "@/components/ModuleWorkbench.vue";
import { useWorkspaceStore } from "@/store/workspace";
import AccountUserDialog from "./AccountUserDialog.vue";
import { useAccountManager } from "./useAccountManager";

const workspace = useWorkspaceStore();
const router = useRouter();
const confirm = useConfirm();
const {
  allowed, contextKey, currentUser, isAdmin, users, selection, dataLoading, saving, busy,
  dataError, notice, editorOpen, editorMode, selectedUser, editorError,
  fetchData, openEditor, submitEditor, applyAction,
} = useAccountManager({ workspace, router, confirm });
const filterSelected = ref(null);
const filterInactive = ref(false);
const accountLabels = { Admin: "管理员", Normal: "普通用户", Guest: "访客" };
const filterOptions = Object.entries(accountLabels).map(([key, title]) => ({
  key,
  title,
}));
const headers = [
  { title: "用户名", key: "username" },
  { title: "邮箱", key: "email" },
  { title: "账号类型", key: "accountType" },
  { title: "状态", key: "disabled" },
  { title: "上次登录", key: "last_login" },
  { title: "", key: "actions", sortable: false, align: "end" },
];
const bulkActions = [
  {
    value: "admin",
    title: "设为管理员",
    icon: "mdi-shield-account-outline",
    cy: "admin-user-bulk-make-admin",
  },
  {
    value: "normal",
    title: "设为普通用户",
    icon: "mdi-account-outline",
    cy: "admin-user-bulk-make-normal",
  },
  {
    value: "enable",
    title: "解锁账号",
    icon: "mdi-lock-open-outline",
    cy: "admin-user-bulk-unlock-selected",
  },
  {
    value: "disable",
    title: "锁定账号",
    icon: "mdi-lock-outline",
    cy: "admin-user-bulk-lock-selected",
  },
  {
    value: "delete",
    title: "删除账号",
    icon: "mdi-delete-outline",
    cy: "admin-user-bulk-delete-selected",
  },
];
const tableItems = computed(() =>
  users.value.filter((user) => {
    if (filterSelected.value && user.accountType !== filterSelected.value)
      return false;
    if (!filterInactive.value) return true;
    const lastLogin = new Date(user.last_login).getTime();
    return (
      !user.last_login ||
      (Number.isFinite(lastLogin) && Date.now() - lastLogin > 30 * 86400000)
    );
  }),
);
const formatDate = (value) => {
  if (!value) return "暂无记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "暂无记录"
    : date.toLocaleString("zh-CN");
};

onMounted(() => workspace.refresh());
</script>

<style scoped>
.account-toolbar {
  display: grid;
  grid-template-columns: minmax(170px, 230px) minmax(170px, 1fr) auto;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
}
.account-profile {
  max-width: 720px;
}
.account-profile dl {
  display: grid;
  grid-template-columns: 100px minmax(0, 1fr);
  gap: 18px;
  margin-bottom: 28px;
  font-size: 13px;
}
.account-profile dt {
  color: var(--ws-muted);
}
.account-profile dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.account-danger {
  border-top: 1px solid var(--ws-border);
  margin-top: 36px;
  padding-top: 24px;
}
@media (max-width: 1000px) {
  .account-toolbar {
    grid-template-columns: minmax(0, 1fr);
    gap: 10px;
  }
}
</style>
