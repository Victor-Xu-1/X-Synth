export const KETCHER_URL = "/ketcher-standalone/index.html";
const interruptedEditors = new WeakSet();

export function waitForKetcher(getFrame, { signal, timeoutMs = 18000 } = {}) {
  return new Promise((resolve, reject) => {
    let timer;
    const started = Date.now();
    const finish = (error, editor) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(editor);
    };
    const abort = () => finish(new Error("Ketcher operation cancelled"));
    const poll = () => {
      if (signal?.aborted) return abort();
      const editor = getFrame()?.contentWindow?.ketcher;
      if (
        editor?.editor &&
        typeof editor.setMolecule === "function" &&
        typeof editor.getSmiles === "function"
      ) {
        return finish(null, editor);
      }
      if (Date.now() - started >= timeoutMs) {
        return finish(new Error("Ketcher editor did not become ready"));
      }
      timer = setTimeout(poll, 100);
    };
    signal?.addEventListener("abort", abort, { once: true });
    poll();
  });
}

export async function replaceKetcherMolecule(
  ketcher,
  value,
  { signal, timeoutMs = 18000 } = {},
) {
  if (signal?.aborted) throw new Error("Ketcher operation cancelled");
  if (interruptedEditors.has(ketcher))
    throw new Error("Ketcher must be reloaded after an interrupted import");
  if (!value) {
    ketcher.editor.clear();
    return;
  }
  const bus = ketcher.eventBus;
  if (
    typeof bus?.on !== "function" ||
    typeof bus?.removeListener !== "function"
  )
    throw new Error("Ketcher import completion events are unavailable");
  // The bundled editor resolves setMolecule before parsing; terminal events settle the write.
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      bus.removeListener("SUCCESS", success);
      bus.removeListener("FAILURE", failure);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    };
    const success = () => finish();
    const failure = () => finish(new Error("Ketcher structure import failed"));
    const abort = () => {
      interruptedEditors.add(ketcher);
      finish(new Error("Ketcher operation cancelled"));
    };
    const timer = setTimeout(() => {
      interruptedEditors.add(ketcher);
      finish(new Error("Ketcher structure import timed out"));
    }, timeoutMs);
    bus.on("SUCCESS", success);
    bus.on("FAILURE", failure);
    signal?.addEventListener("abort", abort, { once: true });
    try {
      Promise.resolve(ketcher.setMolecule(value)).catch(finish);
    } catch (error) {
      finish(error);
    }
  });
}

export function createKetcherWriter(getEditor, options = {}) {
  let pending = Promise.resolve();
  let revision = 0;
  const enqueue = (value) => {
    const requested = ++revision;
    const write = async () => {
      if (requested !== revision) return false;
      const ketcher = await getEditor();
      if (requested !== revision) return false;
      await replaceKetcherMolecule(ketcher, value, options);
      return requested === revision;
    };
    pending = pending.then(write, write);
    return pending;
  };
  enqueue.flush = () => pending;
  return enqueue;
}
