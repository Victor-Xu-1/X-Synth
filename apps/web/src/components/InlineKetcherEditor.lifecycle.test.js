import { EventEmitter } from "node:events";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import InlineKetcherEditor from "./InlineKetcherEditor.vue";

// Native API doubles exercise host layout ownership, not chemistry parsing.
function nativeEditor() {
  const eventBus = new EventEmitter();
  return {
    eventBus,
    setMolecule: jest.fn(() => queueMicrotask(() => eventBus.emit("SUCCESS"))),
    getSmiles: jest.fn(async () => ""),
    editor: {
      clear: jest.fn(),
      struct: () => ({ atoms: { size: 0 } }),
      zoom: jest.fn(),
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

  test("explicit same-input retry clears a failed verification only after a successful owned write", async () => {
    const afterImport = jest.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const contentApplied = jest.fn();
    const { frame, iframe } = createEditor({ smiles: "CCO", afterImport, contentApplied });
    iframe.contentWindow.ketcher = nativeEditor();
    await jest.advanceTimersByTimeAsync(160);
    expect(wrapper.find(".editor-error").exists()).toBe(true);
    expect(contentApplied).not.toHaveBeenCalled();
    const retry = wrapper.vm.$.exposed.retryEditor();
    await jest.advanceTimersByTimeAsync(32);
    await retry;
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
    const retry = wrapper.vm.$.exposed.retryEditor();
    await jest.advanceTimersByTimeAsync(32); await retry;
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
});
