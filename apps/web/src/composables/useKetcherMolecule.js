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
  readStructure = (editor) => editor.getSmiles(),
  editorContent = (value) => value,
  afterImport = null,
  onApplied = () => {},
  onPublished = () => {},
  formatError = (_failure, fallback) => fallback,
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
    readRevision = 0,
    publishing = false,
    timer,
    ketcher,
    subscription;
  let readQueue = Promise.resolve();
  let writeQueue = Promise.resolve();
  let verificationController;
  let failedRead;

  function invalidate() {
    clearTimeout(timer);
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
        dirty.value = false;
        status.value = options.statusMessage || "画板就绪";
        return true;
      } catch (failure) {
        if (current(requested)) {
          error.value = formatError(
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
  function readSnapshot(reader = readStructure, shouldPublish = false) {
    const requested = revision;
    const epoch = readRevision;
    const canRead = () =>
      current(requested) && epoch === readRevision && !disabled();
    const read = async () => {
      if (!canRead()) return null;
      reads.value++;
      let readingCanvas = false;
      try {
        // Preparation, native import and accepted context are one owned write transaction.
        await writeQueue;
        await writeMolecule.flush();
        if (!canRead() || error.value) return null;
        readingCanvas = true;
        const editor = await getEditor();
        const content = await reader(editor);
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
          dirty.value = false;
          status.value = value ? "结构已同步" : "当前画板为空";
        } else if (canRead()) status.value = "画板就绪";
        return value || null;
      } catch (failure) {
        if (canRead() && readingCanvas) {
          failedRead = { reader, shouldPublish };
          error.value = formatError(failure, "结构读取失败，请检查画板内容。");
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
  function readSmilesFromEditor() {
    return readSnapshot(readStructure, true);
  }
  async function retryFailedOperation() {
    if (disabled() || busy.value || signal.aborted) return;
    if (!ready.value) return initialize();
    if (!failedRead) return setSmilesToEditor();
    const { reader, shouldPublish } = failedRead;
    error.value = "";
    status.value = "正在读取画板";
    return readSnapshot(reader, shouldPublish);
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
    let handedToWriter = false;
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
      handedToWriter = true;
      await setSmilesToEditor();
    } catch (failure) {
      // The write queue alone publishes current write errors, including initial writes.
      if (!handedToWriter && !signal.aborted) {
        error.value = formatError(
          failure,
          "结构绘制器未就绪，请检查输入或重新打开画板。",
        );
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
      if (value) {
        readRevision++;
        clearTimeout(timer);
      } else if (autoSync() && ready.value && dirty.value)
        readSmilesFromEditor();
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
    readSnapshot,
    retryFailedOperation,
  };
}
