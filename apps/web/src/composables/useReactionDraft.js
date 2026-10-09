import { computed, onBeforeUnmount, ref, watch } from "vue";
import { API } from "@/common/api";
import { errorMessage } from "@/common/workspace-errors";
import {
  parseCanvasReaction,
  readReactionCanvas,
} from "@/common/ketcher-reaction";
import {
  checkedReactionDraft,
  REACTION_DRAFT_PATH,
  REACTION_REQUEST_TIMEOUT_MS,
} from "@/common/reaction-input";
import { compactInitialReaction, requireSameReactionRoles } from "@/common/ketcher-reaction-layout";
import { runKetcherOperation } from "@/common/ketcher-native-operations";

export function useReactionDraft({
  text,
  boardPending,
  requireReactants,
  api = API,
}) {
  const parsed = ref(null),
    selected = ref(""),
    loading = ref(false),
    error = ref("");
  let revision = 0,
    timer,
    disposed = false;
  let cachedContent, cachedDraft, cachedValue;
  let parseController;
  let compoundGroups,
    canvasReaction = false;
  function parseText(content) {
    if (disposed) return Promise.reject(new DOMException("Reaction parsing cancelled", "AbortError"));
    const requested = {
      format: "smiles",
      content: content.trim(),
      single_role: "product",
    };
    if (cachedContent !== requested.content) {
      cancelParsing();
      cachedContent = requested.content;
      cachedValue = null;
      const controller = new AbortController();
      parseController = controller;
      const request = api
        .post(REACTION_DRAFT_PATH, requested, false, { signal: controller.signal, timeoutMs: REACTION_REQUEST_TIMEOUT_MS })
        .then((value) => {
          if (controller.signal.aborted) throw controller.signal.reason;
          return checkedReactionDraft(value, requested);
        });
      cachedDraft = request;
      request.then(
        (value) => {
          if (cachedDraft === request) cachedValue = value;
        },
        () => {},
      );
      request.catch(() => {
        if (cachedDraft === request) cachedContent = undefined;
      });
    }
    return cachedDraft;
  }
  function cancelParsing() {
    parseController?.abort();
    parseController = undefined;
    cachedContent = cachedDraft = cachedValue = undefined;
  }
  async function prepareContent(content) {
    const value = await parseText(content);
    if (value.input_kind === "molecule") return value.reaction_smiles;
    if (
      typeof value.canvas_rxn !== "string" ||
      !value.canvas_rxn.startsWith("$RXN") ||
      value.canvas_rxn.length > 2 * 1024 * 1024
    )
      throw new Error("反应绘图数据不完整。");
    return value.canvas_rxn;
  }
  const declaredGroups = value => Object.fromEntries(
    ["reactants", "products", "agents"].map(role => [role,
      value[role].filter(record => record.components > 1).map(record => record.smiles)]),
  );
  async function layoutImported({ ketcher, source, write, current, signal }) {
    if (!source.trim() || !current()) return;
    if (cachedContent !== source.trim() || !cachedValue)
      throw new Error("反应画板与当前输入不一致。");
    const expected = cachedValue;
    if (expected.input_kind !== "reaction" || !expected.reactants.length || !expected.products.length
      || expected.agents.reduce((count, record) => count + record.components, 0) < 4) return;
    const document = JSON.parse(await runKetcherOperation(ketcher, () => ketcher.getKet(), current));
    if (!current()) return;
    const layout = compactInitialReaction(document, expected,
      ketcher.editor?.render?.clientArea?.getBoundingClientRect?.());
    if (!layout) return;
    let applied = false;
    try {
      applied = await write(JSON.stringify(layout));
      if (!applied || !current()) return;
      const content = await runKetcherOperation(ketcher, () => ketcher.getRxn("v3000"), current);
      if (!current()) return;
      const checked = await parseCanvasReaction(content, declaredGroups(expected), api,
        { signal, timeoutMs: REACTION_REQUEST_TIMEOUT_MS });
      if (!current()) return;
      requireSameReactionRoles(expected, checked);
    } catch (failure) {
      if (applied && current()) await write(expected.canvas_rxn);
      throw failure;
    }
  }
  function canvasApplied(content) {
    if (!content.trim()) {
      compoundGroups = undefined;
      canvasReaction = false;
      return;
    }
    if (cachedContent !== content.trim() || !cachedValue)
      throw new Error("反应画板与当前输入不一致。");
    compoundGroups = declaredGroups(cachedValue);
    canvasReaction = cachedValue.input_kind === "reaction";
  }
  const readCanvas = (editor, context) =>
    readReactionCanvas(editor, compoundGroups, api, canvasReaction, context);
  function canvasRead(snapshot) {
    if (snapshot.kind === "empty") {
      compoundGroups = undefined;
      canvasReaction = false;
    } else if (["reaction", "molecule"].includes(snapshot.kind))
      canvasReaction = snapshot.kind === "reaction";
    else throw new Error("反应画板读取状态不完整。");
  }
  const parseCanvas = (content) =>
    parseCanvasReaction(content, compoundGroups, api);
  const selectedProduct = computed(() =>
    parsed.value?.products.find((record) => record.smiles === selected.value),
  );
  const product = computed(() => selectedProduct.value?.smiles || "");
  const reactants = computed(
    () => parsed.value?.reactants.map((record) => record.smiles) || [],
  );
  const agents = computed(() => parsed.value?.agents || []);
  const incomplete = computed(
    () =>
      text.value.trim() &&
      (!product.value || (requireReactants() && !reactants.value.length)),
  );
  const structurePending = computed(
    () =>
      !!(
        boardPending.value ||
        loading.value ||
        error.value ||
        (text.value.trim() && !parsed.value)
      ),
  );
  const pending = computed(() => structurePending.value || !!incomplete.value);
  function invalidate({ cancel = false } = {}) {
    if (cancel || disposed || cachedContent !== text.value.trim()) cancelParsing();
    revision++;
    clearTimeout(timer);
    parsed.value = null;
    loading.value = false;
    error.value = "";
  }
  async function validate() {
    if (disposed || boardPending.value || !text.value.trim()) return;
    const current = revision;
    const requested = {
      format: "smiles",
      content: text.value.trim(),
      single_role: "product",
    };
    loading.value = true;
    try {
      const value = await parseText(requested.content);
      if (
        disposed ||
        current !== revision ||
        boardPending.value ||
        text.value.trim() !== requested.content
      )
        return;
      parsed.value = value;
      if (!value.products.some((record) => record.smiles === selected.value))
        selected.value =
          value.products.length === 1 ? value.products[0].smiles : "";
    } catch (failure) {
      if (!disposed && current === revision)
        error.value = errorMessage(
          failure,
          "反应结构无法解析，请核对画板与反应 SMILES。",
        );
    } finally {
      if (current === revision) loading.value = false;
    }
  }
  watch(
    [text, boardPending],
    () => {
      invalidate();
      if (text.value.trim() && !boardPending.value) {
        loading.value = true;
        timer = setTimeout(validate, 180);
      }
    },
    { immediate: true, flush: "sync" },
  );
  onBeforeUnmount(() => {
    disposed = true;
    invalidate({ cancel: true });
  });
  return {
    parsed,
    selected,
    product,
    reactants,
    agents,
    loading,
    error,
    pending,
    structurePending,
    invalidate,
    validate,
    prepareContent,
    layoutImported,
    canvasApplied,
    readCanvas,
    canvasRead,
    parseCanvas,
  };
}
