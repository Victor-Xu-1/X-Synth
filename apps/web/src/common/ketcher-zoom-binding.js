export function createKetcherZoomBinding(publish) {
  let editor = null, subscription;
  function read() {
    const value = editor?.zoom();
    publish(Number.isFinite(value) && value > 0 ? value : null);
  }
  function release() {
    if (subscription !== undefined) editor.unsubscribe("selectionChange", subscription);
    editor = null; subscription = undefined;
    publish(null);
  }
  function bind(next) {
    if (editor === next && subscription !== undefined) { read(); return; }
    if (["zoom", "subscribe", "unsubscribe"].some(key => typeof next?.[key] !== "function"))
      throw new Error("Ketcher zoom events are unavailable");
    release();
    editor = next;
    subscription = next.subscribe("selectionChange", value => {
      if (editor === next) read();
      return value;
    });
    read();
  }
  return { bind, release };
}
