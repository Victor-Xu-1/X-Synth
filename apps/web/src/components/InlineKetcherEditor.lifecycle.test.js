import { EventEmitter } from "node:events";
import { mount } from "@vue/test-utils";
import { nextTick, ref } from "vue";
import InlineKetcherEditor from "./InlineKetcherEditor.vue";
import { provideWorkbenchActivity } from "./workspace/workbench-activity";
import DrawingViewTools from "./workspace/DrawingViewTools.vue";

// Native API doubles exercise host layout ownership, not chemistry parsing.
function nativeEditor() {
  const eventBus = new EventEmitter();
  const events = new EventEmitter();
  let zoom = 1;
  return {
    eventBus,
    setMolecule: jest.fn(() => queueMicrotask(() => eventBus.emit("SUCCESS"))),
    getSmiles: jest.fn(async () => ""),
    editor: {
      clear: jest.fn(),
      struct: () => ({ atoms: { size: 0 } }),
      zoom: jest.fn(value => { if (value !== undefined) zoom = value; return zoom; }),
      subscribe: jest.fn((name, handler) => { events.on(name, handler); return { handler }; }),
      unsubscribe: jest.fn((name, token) => events.removeListener(name, token.handler)),
      selection: () => ({}),
      event: { selectionChange: { dispatch: () => events.emit("selectionChange") } },
      zoomAccordingContent: jest.fn(),
      render: { update: jest.fn() },
    },
  };
}

describe("inline Ketcher viewport lifecycle", () => {
  let wrapper;
  let width;
  let observer;
  let previousObserver;

  beforeEach(() => {
    jest.useFakeTimers();
    width = 620;
    previousObserver = global.ResizeObserver;
    global.ResizeObserver = class {
      constructor(callback) {
        observer = this;
        this.callback = callback;
        this.disconnect = jest.fn();
      }
      observe() {}
    };
    jest.spyOn(HTMLElement.prototype, "getClientRects")
      .mockImplementation(() => [{ width, height: 380 }]);
    jest.spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(() => ({ width, height: 380 }));
    jest.spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockImplementation(() => width);
    jest.spyOn(window, "scrollTo").mockImplementation(() => {});
    jest.spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => window.setTimeout(callback, 16));
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    global.ResizeObserver = previousObserver;
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function createEditor(props = {}) {
    wrapper = mount(InlineKetcherEditor, {
      attachTo: document.body,
      props: { smiles: "", fillHeight: true, canvasHeight: 380, showActions: false, ...props },
      global: { stubs: { VProgressLinear: true, VBtn: true,
        VTooltip: { template: '<span><slot name="activator" :props="{}" /></span>' } } },
    });
    return {
      frame: wrapper.get(".inline-ketcher-frame").element,
      iframe: wrapper.get("iframe").element,
    };
  }

  function viewport(frame) {
    return {
      width: frame.style.getPropertyValue("--ketcher-viewport-width"),
      height: frame.style.getPropertyValue("--ketcher-viewport-height"),
    };
  }

  async function retryInFreshFrame(previous) {
    const retry = wrapper.vm.$.exposed.retryEditor();
    await nextTick();
    const freshFrame = wrapper.get("iframe").element, native = nativeEditor();
    expect(freshFrame).not.toBe(previous);
    freshFrame.contentWindow.ketcher = native;
    await jest.advanceTimersByTimeAsync(160);
    await retry;
    return native;
  }

  test("initial layout and verification remain in the owned write transaction", async () => {
    let release;
    const afterImport = jest.fn(() => new Promise(resolve => { release = resolve; }));
    const contentApplied = jest.fn();
    const { frame, iframe } = createEditor({ smiles: "CCO", afterImport, contentApplied });
    const ketcher = nativeEditor();
    iframe.contentWindow.ketcher = ketcher;
    await jest.advanceTimersByTimeAsync(160);
    await nextTick();
    expect(afterImport).toHaveBeenCalledTimes(1);
    expect(frame.getAttribute("aria-busy")).toBe("true");
    expect(contentApplied).not.toHaveBeenCalled();
    release();
    await jest.advanceTimersByTimeAsync(32);
    await nextTick();
    expect(contentApplied).toHaveBeenCalledWith("CCO");
    expect(frame.getAttribute("aria-busy")).toBe("false");
  });

  test("superseding initial layout cancels its verification and never applies its old context", async () => {
    const held = [];
    const afterImport = jest.fn(context => new Promise(resolve => held.push({ context, resolve })));
    const contentApplied = jest.fn();
    const { frame, iframe } = createEditor({ smiles: "CCO", afterImport, contentApplied });
    iframe.contentWindow.ketcher = nativeEditor();
    await jest.advanceTimersByTimeAsync(160);
    expect(held).toHaveLength(1);
    await wrapper.setProps({ smiles: "CCN" });
    expect(held[0].context.signal.aborted).toBe(true);
    expect(held[0].context.current()).toBe(false);
    expect(await held[0].context.write("obsolete" )).toBe(false);
    held[0].resolve();
    await jest.advanceTimersByTimeAsync(32);
    expect(held).toHaveLength(2);
    expect(frame.getAttribute("aria-busy")).toBe("true");
    expect(contentApplied).not.toHaveBeenCalled();
    held[1].resolve();
    await jest.advanceTimersByTimeAsync(32);
    expect(contentApplied).toHaveBeenCalledTimes(1);
    expect(contentApplied).toHaveBeenCalledWith("CCN");
    expect(frame.getAttribute("aria-busy")).toBe("false");
  });

  test("a disposed layout cannot write, verify or publish after its response returns", async () => {
    let held;
    const afterImport = context => new Promise(resolve => { held = { context, resolve }; });
    const contentApplied = jest.fn();
    const { iframe } = createEditor({ smiles: "CCO", afterImport, contentApplied });
    const native = nativeEditor(); iframe.contentWindow.ketcher = native;
    await jest.advanceTimersByTimeAsync(160);
    wrapper.unmount(); wrapper = null;
    expect(held.context.signal.aborted).toBe(true);
    expect(await held.context.write("obsolete")).toBe(false);
    held.resolve();
    await jest.advanceTimersByTimeAsync(32);
    expect(contentApplied).not.toHaveBeenCalled();
    expect(native.setMolecule).toHaveBeenCalledTimes(1);
  });

  test("a rejected obsolete initial verification cannot leave a successful replacement pending", async () => {
    const held = [];
    const afterImport = context => new Promise((resolve, reject) => {
      context.signal.addEventListener("abort", () => reject(new DOMException("obsolete verification", "AbortError")), { once: true });
      held.push({ context, resolve });
    });
    const contentApplied = jest.fn();
    const { frame, iframe } = createEditor({ smiles: "CCO", afterImport, contentApplied });
    iframe.contentWindow.ketcher = nativeEditor();
    await jest.advanceTimersByTimeAsync(160);
    await wrapper.setProps({ smiles: "CCN" });
    await jest.advanceTimersByTimeAsync(32);
    expect(held).toHaveLength(2);
    held[1].resolve();
    await jest.advanceTimersByTimeAsync(32);
    expect(contentApplied).toHaveBeenCalledWith("CCN");
    expect(wrapper.find(".editor-error").exists()).toBe(false);
    expect(frame.getAttribute("aria-busy")).toBe("false");
  });

  test("explicit same-input retry clears a failed verification only after a fresh owned write", async () => {
    const afterImport = jest.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const contentApplied = jest.fn();
    const { frame, iframe } = createEditor({ smiles: "CCO", afterImport, contentApplied });
    iframe.contentWindow.ketcher = nativeEditor();
    await jest.advanceTimersByTimeAsync(160);
    expect(wrapper.find(".editor-error").exists()).toBe(true);
    expect(contentApplied).not.toHaveBeenCalled();
    expect(wrapper.vm.$.exposed.ready.value).toBe(false);
    const fresh = await retryInFreshFrame(iframe);
    expect(fresh.setMolecule).toHaveBeenCalledWith("CCO");
    expect(afterImport).toHaveBeenCalledTimes(2);
    expect(contentApplied).toHaveBeenCalledWith("CCO");
    expect(wrapper.find(".editor-error").exists()).toBe(false);
    expect(frame.getAttribute("aria-busy")).toBe("false");
  });

  test("retrying a failed canvas read preserves the drawing instead of restoring old text", async () => {
    const { iframe } = createEditor({ smiles: "CCO" });
    const native = nativeEditor();
    native.getSmiles = jest.fn().mockRejectedValueOnce(new Error("offline read")).mockResolvedValue("CCN");
    iframe.contentWindow.ketcher = native;
    await jest.advanceTimersByTimeAsync(160);
    const read = wrapper.vm.$.exposed.readSmilesFromEditor();
    await jest.advanceTimersByTimeAsync(32); await read;
    expect(wrapper.find(".editor-error").exists()).toBe(true);
    const retry = wrapper.vm.$.exposed.retryEditor();
    await jest.advanceTimersByTimeAsync(32); await retry;
    expect(native.setMolecule).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted("commit")).toEqual([["CCN"]]);
    expect(wrapper.find(".editor-error").exists()).toBe(false);
  });

  test("a timed-out import retries the latest text in a fresh frame with one live change subscription", async () => {
    const { iframe } = createEditor({ smiles: "CCO", autoSync: true });
    const first = nativeEditor();
    first.editor.subscribe = jest.fn(() => "first-subscription");
    first.editor.unsubscribe = jest.fn();
    iframe.contentWindow.ketcher = first;
    await jest.advanceTimersByTimeAsync(160);
    first.setMolecule.mockImplementation(() => Promise.resolve());
    await wrapper.setProps({ smiles: "CCN" });
    await jest.advanceTimersByTimeAsync(18100);
    expect(wrapper.find(".editor-error").exists()).toBe(true);
    expect(wrapper.emitted("commit")).toBeUndefined();
    first.editor.subscribe.mock.calls.find(([name]) => name === "change")[1]();
    first.eventBus.emit("SUCCESS");
    await jest.advanceTimersByTimeAsync(300);
    expect(wrapper.find(".editor-error").exists()).toBe(true);

    const retry = wrapper.vm.$.exposed.retryEditor();
    await nextTick();
    const freshFrame = wrapper.get("iframe").element;
    expect(freshFrame).not.toBe(iframe);
    let changed;
    const fresh = nativeEditor();
    fresh.editor.subscribe = jest.fn((event, callback) => { if (event === "change") changed = callback; return "fresh-subscription"; });
    fresh.editor.unsubscribe = jest.fn();
    fresh.getSmiles.mockResolvedValue("CCCl");
    freshFrame.contentWindow.ketcher = fresh;
    await jest.advanceTimersByTimeAsync(160);
    await retry;
    expect(first.editor.unsubscribe).toHaveBeenCalledWith("change", "first-subscription");
    expect(fresh.setMolecule).toHaveBeenCalledWith("CCN");
    expect(fresh.editor.subscribe.mock.calls.filter(([name]) => name === "change")).toHaveLength(1);
    expect(fresh.editor.subscribe.mock.calls.filter(([name]) => name === "selectionChange")).toHaveLength(1);
    expect(wrapper.find(".editor-error").exists()).toBe(false);
    changed();
    await jest.advanceTimersByTimeAsync(300);
    expect(wrapper.emitted("commit")).toEqual([["CCCl"]]);
    expect(fresh.setMolecule).toHaveBeenCalledTimes(1);
  });

  test("an obsolete export does not block recovery or publish into the fresh owner", async () => {
    const { iframe } = createEditor({ smiles: "CCO" });
    const first = nativeEditor(); iframe.contentWindow.ketcher = first;
    await jest.advanceTimersByTimeAsync(160);
    let finishOld;
    first.getSmiles.mockImplementation(() => new Promise(resolve => { finishOld = resolve; }));
    const oldRead = wrapper.vm.$.exposed.readSmilesFromEditor();
    await jest.advanceTimersByTimeAsync(32);
    first.setMolecule.mockImplementation(() => Promise.resolve());
    await wrapper.setProps({ smiles: "CCN" });
    await jest.advanceTimersByTimeAsync(18100);
    const retry = wrapper.vm.$.exposed.retryEditor();
    await nextTick();
    const freshFrame = wrapper.get("iframe").element;
    expect(freshFrame).not.toBe(iframe);
    const fresh = nativeEditor(); freshFrame.contentWindow.ketcher = fresh;
    await jest.advanceTimersByTimeAsync(160); await retry;
    expect(fresh.setMolecule).toHaveBeenCalledWith("CCN");
    finishOld("CCO"); await oldRead;
    expect(wrapper.emitted("commit")).toBeUndefined();
    expect(wrapper.find(".editor-error").exists()).toBe(false);
  });

  test("disposing an interrupted-import retry never publishes through its late fresh frame", async () => {
    const { iframe } = createEditor({ smiles: "CCO" });
    const first = nativeEditor();
    first.setMolecule.mockImplementation(() => Promise.resolve());
    iframe.contentWindow.ketcher = first;
    await jest.advanceTimersByTimeAsync(18160);
    expect(wrapper.find(".editor-error").exists()).toBe(true);
    const retry = wrapper.vm.$.exposed.retryEditor();
    await nextTick();
    const freshFrame = wrapper.get("iframe").element;
    expect(freshFrame).not.toBe(iframe);
    wrapper.unmount(); wrapper = null;
    const fresh = nativeEditor();
    freshFrame.contentWindow.ketcher = fresh;
    await jest.advanceTimersByTimeAsync(200);
    await retry;
    expect(fresh.setMolecule).not.toHaveBeenCalled();
    expect(fresh.getSmiles).not.toHaveBeenCalled();
  });

  test("a queued read cannot relabel its failed prerequisite write as a canvas-read failure", async () => {
    let rejectInitial;
    const afterImport = jest.fn().mockImplementationOnce(() => new Promise((_, reject) => { rejectInitial = reject; }))
      .mockResolvedValue(undefined);
    const contentApplied = jest.fn();
    const { iframe } = createEditor({ smiles: "CCO", afterImport, contentApplied });
    const native = nativeEditor(); iframe.contentWindow.ketcher = native;
    await jest.advanceTimersByTimeAsync(160);
    const reading = wrapper.vm.$.exposed.readSmilesFromEditor();
    rejectInitial(new Error("initial verification offline"));
    await jest.advanceTimersByTimeAsync(32); await reading;
    expect(native.getSmiles).not.toHaveBeenCalled();
    const fresh = await retryInFreshFrame(iframe);
    expect(fresh.setMolecule).toHaveBeenCalledWith("CCO");
    expect(afterImport).toHaveBeenCalledTimes(2);
    expect(contentApplied).toHaveBeenCalledWith("CCO");
    expect(wrapper.find(".editor-error").exists()).toBe(false);
  });

  test("cold resizes wait for native readiness, then apply the latest dimensions", async () => {
    const { frame, iframe } = createEditor();
    await nextTick();
    expect(viewport(frame)).toEqual({ width: "808px", height: "432px" });

    width = 320;
    window.dispatchEvent(new Event("resize"));
    observer.callback();
    iframe.dispatchEvent(new Event("load"));
    await jest.advanceTimersByTimeAsync(360);
    await nextTick();
    expect(viewport(frame)).toEqual({ width: "808px", height: "432px" });

    const ketcher = nativeEditor();
    iframe.contentWindow.ketcher = ketcher;
    await jest.advanceTimersByTimeAsync(140);
    await nextTick();
    expect(viewport(frame)).toEqual({ width: "320px", height: "380px" });
    expect(ketcher.editor.clear).toHaveBeenCalledTimes(1);
    expect(frame.getAttribute("aria-busy")).toBe("false");

    width = 940;
    window.dispatchEvent(new Event("resize"));
    await jest.advanceTimersByTimeAsync(32);
    await nextTick();
    expect(viewport(frame)).toEqual({ width: "940px", height: "380px" });
  });

  test("disposing a cold editor does not publish dimensions or use a late editor", async () => {
    const { frame, iframe } = createEditor();
    await nextTick();
    const before = viewport(frame);
    const frameWindow = iframe.contentWindow;
    wrapper.unmount();
    wrapper = null;

    const ketcher = nativeEditor();
    frameWindow.ketcher = ketcher;
    width = 320;
    window.dispatchEvent(new Event("resize"));
    observer.callback();
    await jest.advanceTimersByTimeAsync(1000);
    expect(viewport(frame)).toEqual(before);
    expect(ketcher.editor.clear).not.toHaveBeenCalled();
    expect(ketcher.setMolecule).not.toHaveBeenCalled();
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
  });

  test("numeric zoom uses the native camera and releases its own live readout subscription", async () => {
    const { iframe } = createEditor();
    const native = nativeEditor(); iframe.contentWindow.ketcher = native;
    await jest.advanceTimersByTimeAsync(160);
    expect(wrapper.find("select.editor-zoom").element.value).toBe("1");
    await wrapper.find("select.editor-zoom").setValue("0.5");
    await jest.advanceTimersByTimeAsync(16);
    expect(native.editor.zoom()).toBe(.5);
    expect(wrapper.find("select.editor-zoom").element.value).toBe("0.5");
    native.editor.zoom(.75); native.editor.event.selectionChange.dispatch(); await nextTick();
    expect(wrapper.find("select.editor-zoom").element.value).toBe("0.75");
    const token = native.editor.subscribe.mock.results.find((_, index) =>
      native.editor.subscribe.mock.calls[index][0] === "selectionChange").value;
    wrapper.unmount(); wrapper = null;
    expect(native.editor.unsubscribe).toHaveBeenCalledWith("selectionChange", token);
  });

  test("frame interruption clears stale zoom instead of keeping an enabled percentage", async () => {
    const { iframe } = createEditor();
    const native = nativeEditor(); iframe.contentWindow.ketcher = native;
    await jest.advanceTimersByTimeAsync(160);
    expect(wrapper.find("select.editor-zoom").exists()).toBe(true);
    iframe.contentWindow.dispatchEvent(new Event("pagehide")); await nextTick();
    expect(wrapper.find("select.editor-zoom").exists()).toBe(false);
    expect(wrapper.find(".editor-error").exists()).toBe(true);
  });

  test("an acquisition interrupted before its await continuation cannot rebind the retired zoom owner", async () => {
    const { iframe } = createEditor();
    const native = nativeEditor(); iframe.contentWindow.ketcher = native;
    await jest.advanceTimersByTimeAsync(160);
    const editor = native.editor;
    native.getSmiles.mockClear();
    let interrupted = false;
    Object.defineProperty(native, "editor", { get() {
      if (!interrupted) {
        interrupted = true;
        Promise.resolve().then(() => iframe.contentWindow.dispatchEvent(new Event("pagehide")));
      }
      return editor;
    } });
    await wrapper.vm.$.exposed.readSmilesFromEditor();
    await jest.advanceTimersByTimeAsync(32);
    expect(wrapper.vm.$.exposed.ready.value).toBe(false);
    expect(wrapper.find("select.editor-zoom").exists()).toBe(false);
    expect(editor.subscribe.mock.calls.filter(([name]) => name === "selectionChange")).toHaveLength(1);
    expect(editor.unsubscribe.mock.calls.filter(([name]) => name === "selectionChange")).toHaveLength(1);
    expect(native.getSmiles).not.toHaveBeenCalled();
  });

  test("a fit queued before scope deactivation cannot paint after reactivation", async () => {
    const active = ref(true);
    wrapper = mount({ components: { InlineKetcherEditor }, setup() {
      provideWorkbenchActivity(active); return {};
    }, template: '<InlineKetcherEditor smiles="" fill-height :canvas-height="380" :show-actions="false" />' }, {
      attachTo: document.body, global: { stubs: { VProgressLinear: true, VBtn: true,
        VTooltip: { template: '<span><slot name="activator" :props="{}" /></span>' } } },
    });
    const native = nativeEditor(); native.editor.struct = jest.fn(() => ({ atoms: { size: 0 } }));
    wrapper.get("iframe").element.contentWindow.ketcher = native;
    await jest.advanceTimersByTimeAsync(1000); native.editor.struct.mockClear();
    wrapper.findComponent(DrawingViewTools).vm.$emit("fit"); await nextTick();
    active.value = false; active.value = true;
    await jest.advanceTimersByTimeAsync(32);
    expect(native.editor.struct).not.toHaveBeenCalled();
  });
});
