import { computed, onBeforeUnmount, ref, watch } from "vue";
import { API } from "@/common/api";
import { readRuleEntries, RuleFileError, ruleCategory, rulePostPath } from "./rule-file";
import { ruleRequestOptions } from "./rule-owner-scope";

function uploadNotice(chemicals, reactions, failed) {
  const source = failed
    ? chemicals && reactions ? "已添加 {chemicals} 条化合物记录 和 {reactions} 条反应记录，{failed} 条记录失败。"
      : chemicals ? "已添加 {chemicals} 条化合物记录，{failed} 条记录失败。"
      : reactions ? "已添加 {reactions} 条反应记录，{failed} 条记录失败。" : "已添加 ，{failed} 条记录失败。"
    : chemicals && reactions ? "已成功添加 {chemicals} 条化合物记录 和 {reactions} 条反应记录。"
      : chemicals ? "已成功添加 {chemicals} 条化合物记录。" : "已成功添加 {reactions} 条反应记录。";
  return { source, values: { chemicals, reactions, failed }, color: failed ? "warning" : "primary" };
}

export function useRuleUpload({ scope, show, publish }) {
  const multiUploadFile = ref(null), isUploading = ref(false), notice = ref(null), noticeOpen = ref(false);
  const draftEpoch = scope?.ownerEpoch.value;
  const disabled = computed(() => !scope?.allowed.value || draftEpoch !== scope.ownerEpoch.value
    || scope.pendingTasks.value > 0 || isUploading.value);
  let attempt = null;

  function cancel() {
    scope?.cancel(attempt); attempt = null; isUploading.value = false;
  }
  function closeDialog() {
    cancel(); show.value = false; multiUploadFile.value = null;
  }
  async function uploadMultipleEntries() {
    if (disabled.value || !multiUploadFile.value) return;
    const ticket = scope.begin();
    if (!ticket) return;
    const file = multiUploadFile.value;
    attempt = ticket; isUploading.value = true; notice.value = null; noticeOpen.value = false;
    try {
      const entries = await readRuleEntries(file, { signal: ticket.signal });
      if (!scope.active(ticket)) return;
      const counts = { chemicals: 0, reactions: 0 };
      let failed = 0;
      for (const entry of entries) {
        if (!scope.active(ticket)) return;
        const category = ruleCategory(entry.smiles);
        try {
          await API.post(rulePostPath(category, entry), undefined, false, ruleRequestOptions(ticket));
          if (!scope.active(ticket)) return;
          counts[category]++;
        } catch {
          if (!scope.active(ticket)) return;
          failed++;
        }
      }
      for (const category of ["chemicals", "reactions"]) {
        if (!scope.active(ticket)) return;
        if (counts[category]) publish(category, ticket);
      }
      if (!scope.active(ticket)) return;
      notice.value = uploadNotice(counts.chemicals, counts.reactions, failed); noticeOpen.value = true;
      multiUploadFile.value = null;
      if (!failed) show.value = false;
    } catch (error) {
      if (scope.active(ticket)) {
        notice.value = error instanceof RuleFileError
          ? { source: error.source, values: error.values, color: "error" }
          : { source: "添加记录失败，请重试。", color: "error" };
        noticeOpen.value = true;
      }
    } finally {
      if (attempt === ticket) { attempt = null; isUploading.value = false; }
      scope.finish(ticket);
    }
  }

  if (scope) watch(scope.revision, () => {
    cancel(); notice.value = null; noticeOpen.value = false;
  }, { flush: "sync" });
  onBeforeUnmount(cancel);
  return { multiUploadFile, isUploading, notice, noticeOpen, disabled, closeDialog, uploadMultipleEntries };
}
