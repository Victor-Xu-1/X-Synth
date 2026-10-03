export const KETCHER_URL = "/ketcher-standalone/index.html";

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
      if (editor?.editor && typeof editor.setMolecule === "function" && typeof editor.getSmiles === "function") {
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

export async function replaceKetcherMolecule(ketcher, value) {
  if (value) await ketcher.setMolecule(value);
  else ketcher.editor.clear();
}

export function createKetcherWriter(getEditor) {
  let pending = Promise.resolve();
  let revision = 0;
  const enqueue = (value) => {
    const requested = ++revision;
    const write = async () => {
      if (requested !== revision) return false;
      const ketcher = await getEditor();
      if (requested !== revision) return false;
      await replaceKetcherMolecule(ketcher, value);
      return true;
    };
    pending = pending.then(write, write);
    return pending;
  };
  enqueue.flush = () => pending;
  return enqueue;
}
