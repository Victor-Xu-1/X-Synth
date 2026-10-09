export function createKetcherBinding(autoSync, changed) {
  let editor, subscription, bound = false;
  function release() {
    if (subscription !== undefined) editor.editor.unsubscribe("change", subscription);
    subscription = undefined;
    bound = false;
  }
  function bind(next) {
    if (editor === next && bound) return;
    const automatic = autoSync();
    if (automatic && (typeof next.editor.subscribe !== "function" || typeof next.editor.unsubscribe !== "function"))
      throw new Error("Ketcher change events are unavailable");
    release();
    const token = automatic ? next.editor.subscribe("change", changed) : undefined;
    editor = next;
    subscription = token;
    bound = true;
  }
  return { bind, release, get current() { return editor; } };
}
