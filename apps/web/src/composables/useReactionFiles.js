import { computed, onBeforeUnmount, readonly, ref, watch } from "vue";
import { API } from "@/common/api";
import { useWorkbenchActivity } from "@/components/workspace/workbench-activity";
import {
  checkedReactionDraft,
  REACTION_DRAFT_PATH,
  REACTION_REQUEST_TIMEOUT_MS,
  reactionFileBody,
} from "@/common/reaction-input";
import { downloadChemicalFile } from "@/common/chemical-files";
import { errorMessage } from "@/common/workspace-errors";
import {
  exportedReactionDraft,
  reactionRecordsBody,
  ReactionRecordsError,
} from "@/common/reaction-records";

export function useReactionFiles({ text, disabled, board, draft }) {
  const activity = useWorkbenchActivity();
  const fileOperation = ref(null),
    fileBusy = computed(() => fileOperation.value !== null),
    fileDraft = ref(null),
    fileProduct = ref(""),
    fileError = ref(""),
    fileOrigin = ref("file");
  let revision = 0,
    disposed = false,
    applyingFile = false;
  let stagingController;
  function discardFile() {
    stagingController?.abort();
    stagingController = undefined;
    revision++;
    fileDraft.value = null;
    fileProduct.value = "";
    fileOperation.value = null;
    fileOrigin.value = "file";
  }
  watch(
    [text, disabled],
    () => {
      if (!applyingFile) discardFile();
      fileError.value = "";
    },
    { flush: "sync" },
  );
  watch(activity, (active) => {
    // Suspend a presented proposal, but retire work that has not been published.
    if (!active && fileBusy.value) discardFile();
  }, { flush: "sync" });

  async function importFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    return stageImport(async (current, options) => {
      const body = await reactionFileBody(file);
      if (!current()) return null;
      return checkedReactionDraft(
        await API.post(REACTION_DRAFT_PATH, body, false, options),
        body,
      );
    }, "file");
  }
  async function importRecords(records) {
    return stageImport(
      (current, options) =>
        exportedReactionDraft(reactionRecordsBody(records), API, current, options),
      "reference",
    );
  }
  async function stageImport(load, origin) {
    if (disposed || !activity.value || disabled() || fileBusy.value || fileDraft.value) return false;
    discardFile();
    const requested = revision;
    const current = () => !disposed && activity.value && requested === revision && !disabled();
    const controller = new AbortController();
    stagingController = controller;
    fileOrigin.value = origin;
    fileOperation.value = "import";
    fileError.value = "";
    try {
      const value = await load(current, { signal: controller.signal, timeoutMs: REACTION_REQUEST_TIMEOUT_MS });
      if (!current() || !value) return false;
      fileDraft.value = value;
      fileProduct.value =
        value.products.length === 1 ? value.products[0].smiles : "";
      return true;
    } catch (failure) {
      if (current())
        fileError.value =
          failure instanceof ReactionRecordsError
            ? failure.message
            : errorMessage(
                failure,
                origin === "reference"
                  ? "参考反应不能完整载入，未改变画板。"
                  : "RXN 文件无法解析，未改变画板。",
              );
      return false;
    } finally {
      if (stagingController === controller) stagingController = undefined;
      if (current()) fileOperation.value = null;
    }
  }
  function applyFile() {
    if (
      disposed ||
      !activity.value ||
      disabled() ||
      !fileDraft.value ||
      (fileDraft.value.products.length && !fileProduct.value)
    )
      return;
    const value = fileDraft.value;
    applyingFile = true;
    try {
      draft.selected.value = fileProduct.value;
      text.value = value.reaction_smiles;
      discardFile();
    } finally {
      applyingFile = false;
    }
  }
  async function exportFile() {
    if (
      disposed ||
      !activity.value ||
      disabled() ||
      fileBusy.value ||
      fileDraft.value ||
      draft.structurePending.value ||
      !draft.parsed.value ||
      draft.parsed.value.input_kind !== "reaction"
    )
      return;
    const current = ++revision,
      original = text.value,
      identities = draft.parsed.value;
    fileOperation.value = "export";
    fileError.value = "";
    try {
      const content = await board.value.exportRxn();
      if (!content) throw new Error("当前反应无法读取为 RXN。");
      const value = await draft.parseCanvas(content);
      for (const role of ["reactants", "products", "agents"])
        if (
          JSON.stringify(value[role].map((record) => record.smiles).sort()) !==
          JSON.stringify(identities[role].map((record) => record.smiles).sort())
        )
          throw new Error("该反应不能保持结构身份导出为 RXN。");
      if (
        disposed ||
        !activity.value ||
        current !== revision ||
        disabled() ||
        original !== text.value
      )
        return;
      downloadChemicalFile(
        {
          format: "rxn",
          content: value.canvas_rxn,
          media_type: "chemical/x-mdl-rxnfile",
        },
        "reaction",
      );
    } catch (failure) {
      if (!disposed && activity.value && current === revision)
        fileError.value = errorMessage(failure, "完整反应未导出。");
    } finally {
      if (current === revision) fileOperation.value = null;
    }
  }
  onBeforeUnmount(() => {
    disposed = true;
    discardFile();
  });
  return {
    fileOperation: readonly(fileOperation),
    fileBusy,
    fileDraft,
    fileProduct,
    fileError,
    fileOrigin,
    discardFile,
    importFile,
    importRecords,
    applyFile,
    exportFile,
  };
}
