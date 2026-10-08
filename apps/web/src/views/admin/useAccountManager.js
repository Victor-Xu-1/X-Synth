import { computed, onBeforeUnmount, ref, watch } from "vue";
import { API } from "@/common/api";
import { loadAccounts, mutateAccount, saveAccount } from "./account-api";
import { canEditAccount, canMutateAccounts, nativeAccountAuthority } from "./account-access";
import { uiText } from "@/i18n";
import { localizedConfirm } from "@/components/localized-confirm";

export function useAccountManager({ workspace, router, confirm }) {
  const authority = computed(() => nativeAccountAuthority(workspace));
  const contextKey = computed(() => authority.value?.key || "");
  const allowed = computed(() => !!authority.value);
  const currentUser = ref(null), isAdmin = ref(false), users = ref([]), selection = ref([]);
  const dataLoading = ref(false), saving = ref(false), confirming = ref(false);
  const dataError = ref(""), noticeSource = ref(""), noticeValues = ref({});
  const notice = computed(() => uiText(noticeSource.value, noticeValues.value));
  const editorOpen = ref(false), editorMode = ref("new"), selectedUser = ref(null), editorError = ref("");
  const busy = computed(() => dataLoading.value || saving.value || confirming.value);
  let generation = 0, disposed = false, reader, loadedKey = "", editorKey = "";
  const active = (ticket, key) => !disposed && ticket === generation && key === contextKey.value && !!key;
  const verified = () => authority.value && loadedKey === contextKey.value
    && currentUser.value?.username === authority.value.owner ? authority.value : null;

  function clearPrivateState() {
    reader?.abort(); generation++; loadedKey = ""; editorKey = "";
    currentUser.value = null; isAdmin.value = false; users.value = []; selection.value = [];
    editorOpen.value = false; selectedUser.value = null; editorMode.value = "new";
    dataLoading.value = false; saving.value = false; confirming.value = false;
    dataError.value = ""; editorError.value = ""; noticeSource.value = ""; noticeValues.value = {};
  }

  async function fetchData() {
    if (disposed || !authority.value || dataLoading.value) return;
    const scope = { ...authority.value }, ticket = generation;
    reader = new AbortController();
    dataLoading.value = true; dataError.value = "";
    try {
      const result = await loadAccounts({ authority: scope, signal: reader.signal, active: () => active(ticket, scope.key) });
      if (!active(ticket, scope.key)) return;
      currentUser.value = result.current; isAdmin.value = result.admin; users.value = result.users;
      loadedKey = scope.key;
      selection.value = selection.value.filter((name) => users.value.some((user) => user.username === name));
    } catch {
      if (active(ticket, scope.key)) {
        clearPrivateState();
        dataError.value = "账号信息加载失败，请检查身份权限与认证服务状态。";
      }
    } finally {
      if (active(ticket, scope.key)) dataLoading.value = false;
    }
  }

  function openEditor(mode, user = null) {
    const scope = verified();
    if (busy.value || !canEditAccount(scope, isAdmin.value, mode, user?.username)) return;
    if (mode !== "new" && user.username !== scope.owner && !users.value.some((item) => item.username === user.username)) return;
    editorKey = scope.key; editorMode.value = mode;
    selectedUser.value = user ? { ...user } : null;
    editorError.value = ""; editorOpen.value = true;
  }

  async function submitEditor(values, submittedKey = editorKey) {
    const scope = verified(), mode = editorMode.value;
    const target = mode === "new" ? values?.username : selectedUser.value?.username;
    if (busy.value || !editorOpen.value || submittedKey !== editorKey || editorKey !== scope?.key
        || !canEditAccount(scope, isAdmin.value, mode, target) || values?.username !== target) return;
    const ticket = generation, payload = { username: target };
    if (mode !== "password") payload.email = values.email;
    if (mode !== "email") payload.password = values.password;
    if (mode === "email") {
      payload.disabled = selectedUser.value.disabled === true;
      if (typeof selectedUser.value.full_name === "string") payload.full_name = selectedUser.value.full_name;
    }
    saving.value = true; editorError.value = "";
    try {
      await saveAccount(mode, payload);
      if (!active(ticket, scope.key)) return;
      editorOpen.value = false; noticeSource.value = "账号信息已保存。";
      await fetchData();
    } catch {
      if (active(ticket, scope.key)) editorError.value = "保存失败，请检查输入、身份权限与认证服务状态。";
    } finally {
      if (active(ticket, scope.key)) saving.value = false;
    }
  }

  async function applyAction(names, action) {
    const scope = verified();
    if (busy.value || !canMutateAccounts(scope, isAdmin.value, names, action)) return;
    if (names.some((name) => name !== scope.owner && !users.value.some((user) => user.username === name))) return;
    const targets = [...names], ticket = generation;
    confirming.value = true;
    try {
      const accepted = await confirm(localizedConfirm(
        action === "delete" ? "删除账号" : "修改账号状态",
        action === "delete" ? "确定删除 {count} 个账号？此操作无法撤销。" : "确定修改 {count} 个账号的状态或权限？",
        { count: targets.length }, { width: 440 },
      ));
      if (!accepted || !active(ticket, scope.key)) return;
      saving.value = true; dataError.value = ""; noticeSource.value = "";
      let completed = 0, signOut = false;
      for (const name of targets) {
        if (!active(ticket, scope.key) || !canMutateAccounts(verified(), isAdmin.value, [name], action)) return;
        const profile = users.value.find((user) => user.username === name) || currentUser.value;
        try {
          await mutateAccount(name, action, profile);
          if (!active(ticket, scope.key)) return;
          completed++;
          if (name === scope.owner && ["delete", "disable"].includes(action)) { signOut = true; break; }
          if (name === scope.owner && action === "normal") {
            await workspace.refresh(true);
            if (!active(ticket, scope.key)) return;
          }
        } catch {
          if (!active(ticket, scope.key)) return;
          dataError.value = "部分账号操作失败，请刷新后检查权限与账号状态。";
        }
      }
      if (!active(ticket, scope.key)) return;
      noticeSource.value = "已完成 {completed} / {total} 项操作。";
      noticeValues.value = { completed, total: targets.length }; selection.value = [];
      if (signOut) {
        clearPrivateState(); API.clearAuthState(); await router.replace("/login");
      } else {
        const mutationError = dataError.value;
        await fetchData();
        if (active(ticket, scope.key) && mutationError) dataError.value = mutationError;
      }
    } catch {
      if (active(ticket, scope.key)) dataError.value = "账号操作未完成，请刷新后重试。";
    } finally {
      if (active(ticket, scope.key)) { saving.value = false; confirming.value = false; }
    }
  }

  watch(contextKey, () => { clearPrivateState(); if (allowed.value) fetchData(); }, { immediate: true, flush: "sync" });
  onBeforeUnmount(() => { disposed = true; clearPrivateState(); });
  return { allowed, contextKey, currentUser, isAdmin, users, selection, dataLoading, saving, busy,
    dataError, notice, editorOpen, editorMode, selectedUser, editorError, fetchData, openEditor, submitEditor, applyAction };
}
