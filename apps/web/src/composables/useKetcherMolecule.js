import { computed, nextTick, ref, watch } from "vue";
import { createKetcherWriter, KetcherImportInterruptedError } from "@/common/ketcher";
import { createKetcherReadQueue } from "@/common/ketcher-reads";
import { createKetcherBinding } from "@/common/ketcher-binding";
import { runKetcherOperation, ketcherNativeBusy } from "@/common/ketcher-native-operations";

export function useKetcherMolecule({
  smiles,
  getEditor,
  getWindow,
  reloadEditor,
  signal,
  autoSync,
  disabled,
  fitDrawing,
  captureFocus,
  commit,
  onChanged = null,
  readStructure = (editor, context) => runKetcherOperation(editor, () => editor.getSmiles(), context.current),
  editorContent = (value) => value,
  afterImport = null,
  onApplied = () => {},
  onPublished = () => {},
  formatError = (_failure, fallback) => fallback,
}) {
  const ready = ref(false),
    reloadRequired = ref(false),
    error = ref(""),
    status = ref("正在加载画板");
  const writes = ref(0), dirty = ref(false);
  const readers = createKetcherReadQueue();
  const busy = computed(() => writes.value > 0 || readers.pending.value > 0
    || (ready.value && ketcherNativeBusy(binding.current)));
  const pending = computed(
    () => !ready.value || busy.value || dirty.value || !!error.value,
  );
  const writeMolecule = createKetcherWriter(async () => {
    const editor = await getEditor();
    if (signal.aborted) throw new Error("Ketcher operation cancelled");
    bindEditor(editor);
    return editor;
  }, { signal, getWindow });
  let revision = 0,
    publishing = false,
    timer;
  let writeQueue = Promise.resolve();
  let verificationController;
  let failedRead;
  let failedWrite, drawingRecovery;
  let initializing = false;
  const binding = createKetcherBinding(() => autoSync() || !!onChanged, changed);
  function bindEditor(editor) {
    const replaced = editor !== binding.current;
    binding.bind(editor);
    if (replaced) readers.invalidate();
    ready.value = true;
  }

  function interruptEditor() {
    if (!ready.value || signal.aborted) return;
    invalidate();
    failedWrite = drawingRecovery = undefined;
    ready.value = false;
    reloadRequired.value = true;
    binding.release();
    error.value = "画板已中断。尚未同步的绘图未被确认，请重新加载当前文本输入。";
    status.value = error.value;
  }

  function invalidate() {
    clearTimeout(timer);
    readers.invalidate();
    verificationController?.abort();
    failedRead = undefined;
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
    failedWrite = drawingRecovery = undefined;
    const verification = new AbortController();
    verificationController = verification;
    const abortVerification = () => verification.abort();
    error.value = "";
    dirty.value = true;
    writes.value++;
    status.value = "正在同步结构";
    const write = async () => {
      try {
        if (!current(requested)) return false;
        signal.addEventListener("abort", abortVerification, { once: true });
        const content = await editorContent(value);
        if (!current(requested)) return false;
        const applied = await writeMolecule(content);
        if (!applied || !current(requested)) return false;
        if (afterImport) {
          const editor = await getEditor();
          if (!current(requested)) return false;
          await afterImport({ ketcher: editor, source: value,
            write: content => current(requested) ? writeMolecule(content) : false,
            current: () => current(requested), signal: verification.signal });
          if (!current(requested)) return false;
        }
        await fitDrawing();
        if (!current(requested)) return false;
        onApplied(value);
        reloadRequired.value = false;
        dirty.value = false;
        status.value = options.statusMessage || "画板就绪";
        return true;
      } catch (failure) {
        if (current(requested)) {
          reloadRequired.value = failure instanceof KetcherImportInterruptedError;
          if (reloadRequired.value) {
            invalidate();
            ready.value = false;
            binding.release();
          } else failedWrite = { owner: binding.current, write: writeQueue, native: writeMolecule.flush() };
          error.value = reloadRequired.value
            ? "结构导入已中断。重新加载画板后恢复当前文本输入。"
            : formatError(
            failure,
            "结构同步失败，请检查 SMILES 或重新打开画板。",
          );
          status.value = error.value;
        }
        throw failure;
      } finally {
        signal.removeEventListener("abort", abortVerification);
        if (verificationController === verification) verificationController = undefined;
        writes.value--;
      }
    };
    writeQueue = writeQueue.then(write, write);
    return writeQueue;
  }
  async function waitForWrites(canRead) {
    const recovery = drawingRecovery, write = writeQueue, native = writeMolecule.flush();
    const canRecover = () => !!recovery && recovery === drawingRecovery
      && recovery.owner === binding.current && recovery.write === write && recovery.native === native
      && write === writeQueue && native === writeMolecule.flush()
      && ready.value && !reloadRequired.value && canRead();
    // A genuine canvas change retires only its owner's settled failed writes, not a new import.
    try { await write; }
    catch (failure) { if (!canRecover()) throw failure; }
    try { await writeMolecule.flush(); }
    catch (failure) { if (!canRecover()) throw failure; }
    return canRecover();
  }
  function readSnapshot(reader = readStructure, shouldPublish = false) {
    const requested = revision;
    const read = async owned => {
      const canRead = () => current(requested) && owned() && !disabled();
      if (!canRead()) return null;
      let readingCanvas = false;
      try {
        // Preparation, native import and accepted context are one owned write transaction.
        const recovering = await waitForWrites(canRead);
        if (!canRead() || reloadRequired.value || (error.value && !recovering)) return null;
        readingCanvas = true;
        const editor = await getEditor();
        if (editor !== binding.current) throw new KetcherImportInterruptedError("Ketcher owner changed during read");
        const content = await reader(editor, { current: canRead });
        if (!canRead()) return null;
        const snapshot =
          typeof content === "string" ? { text: content } : content;
        if (typeof snapshot?.text !== "string")
          throw new Error("Invalid editor export");
        const value = snapshot.text.trim();
        if (!canRead()) return null;
        failedRead = undefined;
        if (shouldPublish) await publish(value);
        if (shouldPublish && canRead()) {
          onPublished(snapshot);
          error.value = "";
          dirty.value = false;
          status.value = value ? "结构已同步" : "当前画板为空";
        } else if (canRead()) status.value = "画板就绪";
        return value || null;
      } catch (failure) {
        if (canRead() && readingCanvas) {
          if (failure instanceof KetcherImportInterruptedError) {
            interruptEditor();
            return null;
          }
          failedRead = { reader, shouldPublish };
          error.value = formatError(failure, "结构读取失败，请检查画板内容。");
          status.value = error.value;
        }
        return null;
      }
    };
    return readers.enqueue(read);
  }
  function readSmilesFromEditor() {
    return readSnapshot(readStructure, true);
  }
  async function retryFailedOperation() {
    if (disabled() || busy.value || signal.aborted) return;
    if (reloadRequired.value) return reloadEditor && initialize({ reload: true });
    if (!ready.value) return initialize();
    if (!failedRead) return setSmilesToEditor();
    const { reader, shouldPublish } = failedRead;
    error.value = "";
    status.value = "正在读取画板";
    return readSnapshot(reader, shouldPublish);
  }
  function changed() {
    // Imported structures emit the same events as drawing; do not echo them back.
    if (!ready.value || reloadRequired.value || writes.value || disabled() || signal.aborted) return;
    onChanged?.();
    if (!autoSync()) return;
    if (failedWrite) {
      drawingRecovery = failedWrite;
      failedWrite = undefined;
    }
    invalidate();
    if (!drawingRecovery) error.value = "";
    dirty.value = true;
    status.value = "正在读取画板";
    timer = setTimeout(readSmilesFromEditor, 250);
  }
  async function initialize({ reload = false } = {}) {
    if (initializing || signal.aborted) return;
    initializing = true;
    captureFocus();
    if (reload) {
      invalidate();
      ready.value = false;
      error.value = "";
      status.value = "正在重新加载画板";
      binding.release();
    }
    const requested = revision;
    writes.value++;
    let handedToWriter = false;
    try {
      const editor = await (reload ? reloadEditor() : getEditor());
      if (signal.aborted) return;
      bindEditor(editor);
      handedToWriter = true;
      await setSmilesToEditor();
    } catch (failure) {
      // The write queue alone publishes current write errors, including initial writes.
      if (!handedToWriter && current(requested)) {
        error.value = formatError(
          failure,
          "结构绘制器未就绪，请检查输入或重新打开画板。",
        );
        status.value = error.value;
      }
    } finally {
      writes.value--;
      initializing = false;
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
      if (value) {
        readers.invalidate();
        clearTimeout(timer);
      } else if (autoSync() && ready.value && dirty.value)
        readSmilesFromEditor();
    },
    { flush: "sync" },
  );
  function dispose() {
    invalidate();
    failedWrite = drawingRecovery = undefined;
    binding.release();
  }
  signal.addEventListener("abort", dispose, { once: true });
  return {
    ready,
    reloadRequired,
    error,
    status,
    busy,
    pending,
    initialize,
    setSmilesToEditor,
    readSmilesFromEditor,
    clearEditor,
    readSnapshot,
    retryFailedOperation,
    interruptEditor,
  };
}
