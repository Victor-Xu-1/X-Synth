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

  function createEditor() {
    wrapper = mount(InlineKetcherEditor, {
      attachTo: document.body,
      props: { smiles: "", fillHeight: true, canvasHeight: 380, showActions: false },
      global: { stubs: { VProgressLinear: true, VBtn: true } },
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
