import { computed, ref, watch } from "vue";
import { API } from "@/common/api";
import { uiText } from "@/i18n";
import { localizedConfirm } from "@/components/localized-confirm";
import { provideRuleOwnerScope, ruleRequestOptions } from "@/components/banlist/rule-owner-scope";

const categories = ["chemicals", "reactions"];

export function useBanlist({ workspace, confirm }) {
  const scope = provideRuleOwnerScope(workspace);
  const chemicals = ref([]), reactions = ref([]), activeTab = ref(0), filterActive = ref("all");
  const showBanItemDialog = ref(false), showMultiEntryDialog = ref(false);
  const errorSource = ref(""), errorValues = ref({});
  const requestError = computed(() => uiText(errorSource.value, errorValues.value));
  const readers = new Map();
  let privateOwner;
  const collection = (category) => category === "chemicals" ? chemicals : reactions;
  function error(source = "", values = {}) { errorSource.value = source; errorValues.value = values; }

  async function loadCollection(category, origin) {
    if (!categories.includes(category) || origin && !scope.active(origin)) return;
    scope.cancel(readers.get(category));
    const ticket = scope.begin();
    if (!ticket) return;
    readers.set(category, ticket);
    try {
      if (!scope.active(ticket)) return;
      const response = await API.get(`/api/banlist/${category}/get`, null, false, ruleRequestOptions(ticket));
      if (!scope.active(ticket)) return;
      if (!Array.isArray(response) || response.some((item) => !item || item.user !== ticket.owner))
        throw new Error("Invalid owner-bound banlist response");
      collection(category).value = response.map((item) => ({ ...item }));
    } catch {
      if (scope.active(ticket)) error("规则加载失败，请检查身份权限与后端服务状态。");
    } finally {
      if (readers.get(category) === ticket) readers.delete(category);
      scope.finish(ticket);
    }
  }

  async function deleteRules(targets, all) {
    if (scope.pendingTasks.value || !targets.length) return;
    const ticket = scope.begin();
    if (!ticket) return;
    error();
    try {
      const accepted = await confirm(all
        ? localizedConfirm("清空全部规则", "确定删除全部化学品与反应禁用规则？此操作无法撤销。", {}, { width: 440 })
        : localizedConfirm("删除规则", "确定删除此条禁用规则？", {}, { width: 420 }));
      if (!accepted || !scope.active(ticket)) return;
      let failed = 0;
      for (const { id, category } of targets) {
        if (!scope.active(ticket)) return;
        try {
          await API.request("DELETE", `/api/banlist/${category}/delete?_id=${encodeURIComponent(id)}`,
            null, false, ruleRequestOptions(ticket));
          if (!scope.active(ticket)) return;
        } catch {
          if (!scope.active(ticket)) return;
          failed++;
        }
      }
      if (!scope.active(ticket)) return;
      const reload = all ? categories : [...new Set(targets.map((item) => item.category))];
      await Promise.all(reload.map((category) => loadCollection(category, ticket)));
      if (!scope.active(ticket)) return;
      if (failed) error(all ? "有 {count} 条规则删除失败，请刷新后重试。"
        : "删除失败，请检查身份权限与后端服务状态。", { count: failed });
    } catch {
      if (scope.active(ticket)) error(all ? "无法清空规则，请检查后端服务状态。"
        : "删除失败，请检查身份权限与后端服务状态。");
    } finally {
      scope.finish(ticket);
    }
  }
  function deleteEntry(id, category) {
    if (!categories.includes(category) || !collection(category).value.some((item) => item.id === id)) return;
    return deleteRules([{ id, category }], false);
  }
  function deleteAll() {
    const targets = categories.flatMap((category) => collection(category).value.map((item) => ({ id: item.id, category })));
    return deleteRules(targets, true);
  }
  async function toggleActivation(item, category) {
    if (scope.pendingTasks.value || !categories.includes(category)) return;
    const current = collection(category).value.find((row) => row.id === item.id);
    if (!current) return;
    const ticket = scope.begin();
    if (!ticket) return;
    const id = current.id, action = current.active ? "deactivate" : "activate";
    error();
    try {
      if (!scope.active(ticket)) return;
      await API.get(`/api/banlist/${category}/${action}`, { _id: id }, true, ruleRequestOptions(ticket));
      if (!scope.active(ticket)) return;
      await loadCollection(category, ticket);
    } catch {
      if (scope.active(ticket)) error("规则状态更新失败，请检查身份权限与后端服务状态。");
    } finally {
      scope.finish(ticket);
    }
  }

  watch(scope.revision, () => {
    if (privateOwner !== scope.ownerKey.value) {
      privateOwner = scope.ownerKey.value;
      chemicals.value = []; reactions.value = []; activeTab.value = 0; filterActive.value = "all";
      showBanItemDialog.value = false; showMultiEntryDialog.value = false;
    }
    error();
    if (scope.allowed.value) categories.forEach((category) => loadCollection(category));
  }, { immediate: true, flush: "sync" });

  return { scope, allowed: scope.allowed, ownerEpoch: scope.ownerEpoch, pendingTasks: scope.pendingTasks,
    chemicals, reactions, activeTab, filterActive, showBanItemDialog, showMultiEntryDialog,
    requestError, loadCollection, deleteEntry, deleteAll, toggleActivation };
}
