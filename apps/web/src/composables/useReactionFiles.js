import { onBeforeUnmount, ref, watch } from "vue";
import { API } from "@/common/api";
import {
  checkedReactionDraft,
  REACTION_DRAFT_PATH,
  reactionFileBody,
} from "@/common/reaction-input";
import { downloadChemicalFile } from "@/common/chemical-files";
import { errorMessage } from "@/common/workspace-errors";

export function useReactionFiles({ text, disabled, board, draft }) {
  const fileBusy = ref(false),
    fileDraft = ref(null),
    fileProduct = ref(""),
    fileError = ref("");
  let revision = 0,
    disposed = false,
    applyingFile = false;
  function discardFile() {
    revision++;
    fileDraft.value = null;
    fileProduct.value = "";
    fileBusy.value = false;
  }
  watch(
    [text, disabled],
    () => {
      if (!applyingFile) discardFile();
      fileError.value = "";
    },
    { flush: "sync" },
  );

  async function importFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || disabled() || fileBusy.value) return;
    discardFile();
    const current = revision;
    fileBusy.value = true;
    fileError.value = "";
    try {
      const body = await reactionFileBody(file);
      const value = checkedReactionDraft(
        await API.post(REACTION_DRAFT_PATH, body),
        body,
      );
      if (disposed || current !== revision || disabled()) return;
      fileDraft.value = value;
      fileProduct.value =
        value.products.length === 1 ? value.products[0].smiles : "";
    } catch (failure) {
      if (!disposed && current === revision)
        fileError.value = errorMessage(
          failure,
          "RXN 文件无法解析，未改变画板。",
        );
    } finally {
      if (current === revision) fileBusy.value = false;
    }
  }
  function applyFile() {
    if (disabled() || !fileDraft.value || !fileProduct.value) return;
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
      disabled() ||
      fileBusy.value ||
      fileDraft.value ||
      draft.pending.value ||
      !draft.parsed.value ||
      draft.parsed.value.input_kind !== "reaction"
    )
      return;
    const current = ++revision,
      original = text.value,
      identities = draft.parsed.value;
    fileBusy.value = true;
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
      if (!disposed && current === revision)
        fileError.value = errorMessage(failure, "完整反应未导出。");
    } finally {
      if (current === revision) fileBusy.value = false;
    }
  }
  onBeforeUnmount(() => {
    disposed = true;
    discardFile();
  });
  return {
    fileBusy,
    fileDraft,
    fileProduct,
    fileError,
    discardFile,
    importFile,
    applyFile,
    exportFile,
  };
}
