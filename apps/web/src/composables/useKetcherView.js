import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

const failureText = "画板视图操作失败，请重试。";

// Native fullscreen can clamp the ancestor's scroll while its contents leave flow.
function captureScroll(element) {
  const positions = [];
  for (let target = element.parentElement; target; target = target.parentElement) {
    if (target.scrollHeight > target.clientHeight || target.scrollWidth > target.clientWidth)
      positions.push({ target, top: target.scrollTop, left: target.scrollLeft });
  }
  return { owner: element, positions };
}
function restoreScroll(snapshot) {
  for (const { target, top, left } of snapshot.positions) {
    if (!target.isConnected || target.ownerDocument !== snapshot.owner.ownerDocument) continue;
    if (typeof target.scrollTo === "function") target.scrollTo({ top, left, behavior: "instant" });
    else { target.scrollTop = top; target.scrollLeft = left; }
  }
}

export function useKetcherView({ root, active, ready, blocked, onChange, getFrame = () => null }) {
  const expanded = ref(false), supported = ref(false), commands = ref(false), adjustments = ref(0), error = ref("");
  const pending = computed(() => commands.value || adjustments.value > 0);
  let document, frameDocument, disposed = false, epoch = 0, operationEpoch = 0, invoker, lastCommand;
  let changeTask = Promise.resolve();
  let focusReturn, scrollReturn;
  const returnReaders = new Set();
  function watchReturnIntent() {
    const owner = document;
    const state = { interrupted: false };
    const events = ["wheel", "touchstart", "pointerdown", "keydown"];
    const interrupt = event => {
      if (event.type === "keydown" && !["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", "Tab"].includes(event.key)) return;
      state.interrupted = true;
    };
    state.stop = () => { for (const event of events) owner.removeEventListener(event, interrupt, true); returnReaders.delete(state.stop); };
    for (const event of events) owner.addEventListener(event, interrupt, { capture: true, passive: true });
    returnReaders.add(state.stop);
    return state;
  }
  function retireReturn() {
    for (const stop of returnReaders) stop();
    focusReturn = null; scrollReturn = null;
  }
  const owns = element => !!element && document?.fullscreenElement === element;
  const admitted = () => !disposed && active.value && ready.value && !blocked.value && !pending.value;

  async function release(element = root.value, context) {
    if (!owns(element)) return;
    const requested = epoch;
    const current = context?.current ?? (() => !disposed && active.value && requested === epoch);
    try { await document.exitFullscreen(); }
    catch { if (current()) { error.value = failureText; lastCommand = next => release(element, next); } }
  }
  function keydown(event) {
    if (event.key !== "Escape" || !root.value || !owns(root.value)) return;
    event.preventDefault(); event.stopImmediatePropagation(); void release();
  }
  function observeFrame() {
    const owner = getFrame()?.contentDocument;
    if (owner === frameDocument) return;
    frameDocument?.removeEventListener("keydown", keydown, true);
    frameDocument = owner; frameDocument?.addEventListener("keydown", keydown, true);
  }
  async function adjust(context, returnFocus = false, command = onChange) {
    if (!context.current()) return;
    adjustments.value++;
    const intent = returnFocus ? watchReturnIntent() : null;
    try {
      await command(context);
    } catch {
      if (context.current()) { error.value = failureText; lastCommand = next => adjust(next, false, command); }
    } finally {
      await nextTick();
      try {
        intent?.stop();
        if (intent?.interrupted) { scrollReturn = null; focusReturn = null; }
        if (returnFocus && !intent?.interrupted && context.current() && !document.fullscreenElement
          && scrollReturn?.owner === root.value && root.value.isConnected) {
          restoreScroll(scrollReturn); scrollReturn = null;
          focusReturn = { context, owner: root.value, target: invoker };
        }
      } catch {
        if (context.current()) { error.value = failureText; lastCommand = next => adjust(next, true, command); }
      } finally { adjustments.value--; }
    }
  }
  function changed() {
    const next = owns(root.value);
    if (next && (!active.value || pending.value && operationEpoch !== epoch)) {
      void release();
      return;
    }
    if (next === expanded.value) return;
    const previous = expanded.value, current = epoch;
    expanded.value = next;
    changeTask = adjust({ current: () => !disposed && active.value && current === epoch }, previous && !next);
  }
  async function run(command) {
    if (!admitted()) return;
    const current = ++epoch;
    operationEpoch = current;
    commands.value = true; error.value = ""; lastCommand = command;
    try { await command({ current: () => !disposed && active.value && current === epoch }); }
    catch { if (!disposed && active.value && current === epoch) error.value = failureText; }
    finally { commands.value = false; }
  }
  function adjustView(command) {
    if (disposed || !active.value || !ready.value) return;
    const requested = epoch;
    return adjust({ current: () => !disposed && active.value && requested === epoch }, false, command);
  }
  async function toggle(target) {
    if (!admitted() || !supported.value || document.fullscreenElement && !owns(root.value)) return;
    const element = root.value;
    if (!owns(element)) invoker = target || element;
    await run(async context => {
      if (document.fullscreenElement && !owns(element)) return;
      if (owns(element)) await document.exitFullscreen();
      else {
        scrollReturn = captureScroll(element);
        // Keep transient user activation: no await precedes the native request.
        await element.requestFullscreen();
        if (!context.current() || element !== root.value) await release(element);
      }
      if (!disposed) changed();
      await changeTask;
    });
  }
  function observe() {
    const owner = root.value?.ownerDocument;
    if (!owner) return;
    if (document !== owner) {
      document?.removeEventListener("fullscreenchange", changed);
      document?.removeEventListener("keydown", keydown, true);
      document = owner; document.addEventListener("fullscreenchange", changed);
      document.addEventListener("keydown", keydown, true);
    }
    supported.value = !!document.fullscreenEnabled && typeof root.value.requestFullscreen === "function"
      && typeof document.exitFullscreen === "function";
    changed();
    observeFrame();
  }
  watch(active, value => {
    if (value) return;
    epoch++; error.value = ""; lastCommand = null; invoker = null; retireReturn();
    void release();
  }, { flush: "sync" });
  watch(pending, async value => {
    if (value || !focusReturn) return;
    const requested = focusReturn;
    await nextTick();
    if (requested !== focusReturn) return;
    focusReturn = null;
    if (requested.context.current() && requested.owner === root.value && !document.fullscreenElement
      && requested.target?.isConnected && !requested.target.disabled)
      requested.target.focus({ preventScroll: true });
  }, { flush: "post" });
  onMounted(observe);
  onBeforeUnmount(() => {
    disposed = true; epoch++; invoker = null; lastCommand = null; retireReturn(); expanded.value = false;
    document?.removeEventListener("fullscreenchange", changed);
    document?.removeEventListener("keydown", keydown, true);
    frameDocument?.removeEventListener("keydown", keydown, true);
    void release();
  });
  return { expanded, supported, pending, error, observe, observeFrame, toggle, run, adjustView,
    retry: () => lastCommand && run(lastCommand) };
}
