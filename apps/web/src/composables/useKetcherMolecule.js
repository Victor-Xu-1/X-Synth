import { computed, nextTick, ref, watch } from "vue";
import { createKetcherWriter } from "@/common/ketcher";

export function useKetcherMolecule({
  smiles,
  getEditor,
  signal,
  autoSync,
  disabled,
  fitDrawing,
  captureFocus,
  commit,
}) {
  const ready = ref(false),
    error = ref(""),
    status = ref("正在加载画板");
  const writes = ref(0),
    reads = ref(0),
    dirty = ref(false);
  const busy = computed(() => writes.value > 0 || reads.value > 0);
  const pending = computed(
    () => !ready.value || busy.value || dirty.value || !!error.value,
  );
  const writeMolecule = createKetcherWriter(getEditor, { signal });
  let revision = 0,
    publishing = false,
    timer,
    ketcher,
    subscription;
  let readQueue = Promise.resolve();

  function invalidate() {
    clearTimeout(timer);
    return ++revision;
  }
  function current(requested) {
    return requested === revision && !signal.aborted;
  }
  async function publish(value) {
    publishing = true;
    try {
      smiles.value = value;
      commit(value);
      await nextTick();
    } finally {
      publishing = false;
    }
  }
  async function setSmilesToEditor(value = smiles.value, options = {}) {
    captureFocus();
    const requested = invalidate();
    error.value = "";
    dirty.value = true;
    writes.value++;
    status.value = "正在同步结构";
    try {
      const applied = await writeMolecule(value);
      if (!applied || !current(requested)) return false;
      await fitDrawing();
      if (!current(requested)) return false;
      dirty.value = false;
      status.value = options.statusMessage || "画板就绪";
      return true;
    } catch (failure) {
      if (current(requested)) {
        error.value = "结构同步失败，请检查 SMILES 或重新打开画板。";
        status.value = error.value;
      }
      throw failure;
    } finally {
      writes.value--;
    }
  }
  function readSmilesFromEditor() {
    const requested = revision;
    const read = async () => {
      if (!current(requested) || disabled()) return null;
      reads.value++;
      try {
        await writeMolecule.flush();
        if (!current(requested) || error.value) return null;
        const editor = await getEditor();
        const value = String(await editor.getSmiles()).trim();
        if (!current(requested) || disabled()) return null;
        await publish(value);
        if (current(requested)) {
          dirty.value = false;
          status.value = value ? "结构已同步" : "当前画板为空";
        }
        return value || null;
      } catch {
        if (current(requested)) {
          error.value = "结构读取失败，请检查画板内容。";
          status.value = error.value;
        }
        return null;
      } finally {
        reads.value--;
      }
    };
    readQueue = readQueue.then(read, read);
    return readQueue;
  }
  function changed() {
    // Imported structures emit the same events as drawing; do not echo them back.
    if (!autoSync() || writes.value || disabled() || signal.aborted) return;
    invalidate();
    error.value = "";
    dirty.value = true;
    status.value = "正在读取画板";
    timer = setTimeout(readSmilesFromEditor, 250);
  }
  async function initialize() {
    captureFocus();
    try {
      ketcher = await getEditor();
      if (signal.aborted) return;
      if (autoSync()) {
        if (
          typeof ketcher.editor.subscribe !== "function" ||
          typeof ketcher.editor.unsubscribe !== "function"
        )
          throw new Error("Ketcher change events are unavailable");
        subscription = ketcher.editor.subscribe("change", changed);
      }
      ready.value = true;
      await setSmilesToEditor();
    } catch {
      if (!signal.aborted) {
        error.value = "结构绘制器未就绪，请检查输入或重新打开画板。";
        status.value = error.value;
      }
    }
  }
  async function clearEditor() {
    try {
      if (disabled()) return;
      if (await setSmilesToEditor("")) await publish("");
    } catch {
      // The failed import remains pending and visible; never publish an empty fallback.
    }
  }
  watch(
    smiles,
    (value, previous) => {
      if (!publishing && value !== previous)
        setSmilesToEditor(value).catch(() => {});
    },
    { flush: "sync" },
  );
  watch(
    disabled,
    (value) => {
      if (value) invalidate();
      else if (autoSync() && ready.value && dirty.value) readSmilesFromEditor();
    },
    { flush: "sync" },
  );
  function dispose() {
    invalidate();
    if (subscription) ketcher.editor.unsubscribe("change", subscription);
  }
  signal.addEventListener("abort", dispose, { once: true });
  return {
    ready,
    error,
    status,
    busy,
    pending,
    initialize,
    setSmilesToEditor,
    readSmilesFromEditor,
    clearEditor,
  };
}
