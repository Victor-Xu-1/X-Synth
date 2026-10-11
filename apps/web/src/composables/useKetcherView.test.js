import { mount } from "@vue/test-utils";
import { nextTick, ref } from "vue";
import { useKetcherView } from "./useKetcherView";

let api, active, ready, blocked, owner, change;
function create(host = document.body, frameDocument = null) {
  active = ref(true); ready = ref(true); blocked = ref(false); change = jest.fn(); owner = null;
  Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => owner });
  Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: true });
  document.exitFullscreen = jest.fn(async () => { owner = null; document.dispatchEvent(new Event("fullscreenchange")); });
  const wrapper = mount({ setup() {
    const root = ref(null);
    api = useKetcherView({ root, active, ready, blocked, onChange: change,
      getFrame: () => frameDocument ? { contentDocument: frameDocument } : null });
    return { root, pending: api.pending };
  }, template: '<div ref="root" tabindex="-1"><button type="button" :disabled="pending">View</button></div>' }, { attachTo: host });
  wrapper.element.requestFullscreen = jest.fn(async () => { owner = wrapper.element; document.dispatchEvent(new Event("fullscreenchange")); });
  api.observe();
  return wrapper;
}
afterEach(() => { document.body.innerHTML = ""; delete document.fullscreenElement;
  delete document.fullscreenEnabled; delete document.exitFullscreen; });

test("actual document state owns the expanded flag and exit restores the current invoker", async () => {
  const wrapper = create(), button = wrapper.find("button").element;
  await api.toggle(button); expect(api.expanded.value).toBe(true); expect(change).toHaveBeenCalled();
  await api.toggle(button); await nextTick();
  expect(api.expanded.value).toBe(false); expect(document.activeElement).toBe(button);
  wrapper.unmount();
});

function scrollHost() {
  const host = document.createElement("main");
  host.style.overflow = "auto";
  Object.defineProperties(host, { scrollHeight: { value: 1200 }, clientHeight: { value: 480 },
    scrollWidth: { value: 800 }, clientWidth: { value: 600 } });
  host.scrollTo = jest.fn(({ top, left }) => { host.scrollTop = top; host.scrollLeft = left; });
  document.body.appendChild(host);
  return host;
}

test("return restores owned ancestor scroll only after viewport adjustment and preserves invoker focus", async () => {
  const host = scrollHost(), wrapper = create(host), button = wrapper.get("button").element;
  host.scrollTop = 240; host.scrollLeft = 17;
  wrapper.element.requestFullscreen.mockImplementation(async () => {
    host.scrollTop = 0; host.scrollLeft = 0;
    owner = wrapper.element; document.dispatchEvent(new Event("fullscreenchange"));
  });
  await api.toggle(button);
  let finish;
  change.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const close = api.toggle(button);
  await nextTick(); await Promise.resolve();
  expect(api.pending.value).toBe(true); expect(host.scrollTop).toBe(0);
  finish(); await close; await nextTick();
  expect(host.scrollTop).toBe(240); expect(host.scrollLeft).toBe(17);
  expect(host.scrollTo).toHaveBeenCalledWith({ top: 240, left: 17, behavior: "instant" });
  expect(document.activeElement).toBe(button);
  wrapper.unmount();
});

test("Escape return restores the same source position without another fullscreen request", async () => {
  const host = scrollHost(), wrapper = create(host);
  host.scrollTop = 300;
  wrapper.element.requestFullscreen.mockImplementation(async () => {
    host.scrollTop = 0; owner = wrapper.element; document.dispatchEvent(new Event("fullscreenchange"));
  });
  await api.toggle(wrapper.get("button").element);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
  await nextTick(); await Promise.resolve(); await nextTick();
  expect(host.scrollTop).toBe(300);
  expect(wrapper.element.requestFullscreen).toHaveBeenCalledTimes(1);
  wrapper.unmount();
});

test("a failed entry retry snapshots the current position rather than the abandoned attempt", async () => {
  const host = scrollHost(), wrapper = create(host);
  host.scrollTop = 100;
  wrapper.element.requestFullscreen.mockRejectedValueOnce(new Error("entry denied"));
  await api.toggle(wrapper.get("button").element);
  host.scrollTop = 220;
  wrapper.element.requestFullscreen.mockImplementation(async () => {
    host.scrollTop = 0; owner = wrapper.element; document.dispatchEvent(new Event("fullscreenchange"));
  });
  await api.retry(); await api.toggle(wrapper.get("button").element);
  expect(host.scrollTop).toBe(220);
  wrapper.unmount();
});

test("scope retirement prevents a late exit adjustment from restoring another page's position", async () => {
  const host = scrollHost(), wrapper = create(host);
  host.scrollTop = 180; await api.toggle(wrapper.get("button").element);
  let finish;
  change.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const close = api.toggle(wrapper.get("button").element);
  await nextTick(); await Promise.resolve();
  active.value = false; host.scrollTop = 35;
  finish(); await close; await nextTick();
  expect(host.scrollTop).toBe(35); expect(host.scrollTo).not.toHaveBeenCalled();
  wrapper.unmount();
});

test("failed scroll restoration releases pending state and retries the same owned position", async () => {
  const host = scrollHost(), wrapper = create(host);
  host.scrollTop = 250;
  wrapper.element.requestFullscreen.mockImplementation(async () => {
    host.scrollTop = 0; owner = wrapper.element; document.dispatchEvent(new Event("fullscreenchange"));
  });
  await api.toggle(wrapper.get("button").element);
  host.scrollTo.mockImplementationOnce(() => { throw new Error("scroll unavailable"); });
  await api.toggle(wrapper.get("button").element);
  expect(api.pending.value).toBe(false); expect(api.error.value).toBe("画板视图操作失败，请重试。");
  await api.retry(); expect(host.scrollTop).toBe(250); expect(api.error.value).toBe("");
  expect(wrapper.element.requestFullscreen).toHaveBeenCalledTimes(1);
  wrapper.unmount();
});

test("another fullscreen owner during exit adjustment keeps its own scroll and focus", async () => {
  const host = scrollHost(), wrapper = create(host);
  host.scrollTop = 175; await api.toggle(wrapper.get("button").element);
  let finish;
  change.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const close = api.toggle(wrapper.get("button").element);
  await nextTick(); await Promise.resolve();
  owner = document.createElement("video"); owner.tabIndex = 0;
  document.body.appendChild(owner); owner.focus(); host.scrollTop = 28;
  document.dispatchEvent(new Event("fullscreenchange"));
  finish(); await close; await nextTick();
  expect(host.scrollTop).toBe(28); expect(host.scrollTo).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(owner);
  wrapper.unmount();
});

test("new navigation intent during a delayed return retires the old scroll and focus", async () => {
  const host = scrollHost(), wrapper = create(host), other = document.createElement("button");
  host.appendChild(other); host.scrollTop = 190;
  await api.toggle(wrapper.get("button").element);
  let finish;
  change.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const close = api.toggle(wrapper.get("button").element);
  await nextTick(); await Promise.resolve();
  host.dispatchEvent(new Event("wheel", { bubbles: true }));
  host.scrollTop = 27; other.focus();
  finish(); await close; await nextTick();
  expect(host.scrollTop).toBe(27); expect(host.scrollTo).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(other);
  wrapper.unmount();
});

test("native iframe interaction retires a delayed return without bubbling to the host document", async () => {
  const host = scrollHost(), frameDocument = document.implementation.createHTMLDocument();
  const wrapper = create(host, frameDocument);
  host.scrollTop = 240; await api.toggle(wrapper.get("button").element);
  let finish;
  change.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const close = api.toggle(wrapper.get("button").element);
  await nextTick(); await Promise.resolve();
  frameDocument.dispatchEvent(new Event("wheel", { bubbles: true })); host.scrollTop = 32;
  finish(); await close; await nextTick();
  expect(host.scrollTop).toBe(32); expect(host.scrollTo).not.toHaveBeenCalled();
  wrapper.unmount();
});

test("a foreign fullscreen takeover retires the old snapshot even if it exits before adjustment completion", async () => {
  const host = scrollHost(), wrapper = create(host);
  host.scrollTop = 230; await api.toggle(wrapper.get("button").element);
  let finish;
  change.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const close = api.toggle(wrapper.get("button").element);
  await nextTick(); await Promise.resolve();
  owner = document.createElement("video"); document.dispatchEvent(new Event("fullscreenchange"));
  owner = null; document.dispatchEvent(new Event("fullscreenchange")); host.scrollTop = 44;
  finish(); await close; await nextTick();
  expect(host.scrollTop).toBe(44); expect(host.scrollTo).not.toHaveBeenCalled();
  expect(api.pending.value).toBe(false); wrapper.unmount();
});

test("pending or inactive editors cannot issue native requests", async () => {
  const wrapper = create(); blocked.value = true;
  await api.toggle(); blocked.value = false; active.value = false;
  await api.toggle(); expect(wrapper.element.requestFullscreen).not.toHaveBeenCalled(); wrapper.unmount();
});

test("an explicit request failure stays visible and can be retried without touching drawing data", async () => {
  const wrapper = create(); wrapper.element.requestFullscreen.mockRejectedValueOnce(new Error("native denied"));
  await api.toggle(); expect(api.error.value).toBe("画板视图操作失败，请重试。");
  await api.retry(); expect(api.expanded.value).toBe(true); expect(api.error.value).toBe(""); wrapper.unmount();
});

test("scope deactivation releases only the owned fullscreen", async () => {
  const wrapper = create(); await api.toggle(); active.value = false; await nextTick();
  expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
  owner = document.createElement("div"); active.value = true; await nextTick(); wrapper.unmount();
  expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
});

test("a late request after disposal cannot publish state or leave an owned fullscreen", async () => {
  const wrapper = create(); let release;
  wrapper.element.requestFullscreen.mockImplementation(() => new Promise(resolve => { release = () => { owner = wrapper.element; resolve(); }; }));
  const request = api.toggle(); wrapper.unmount(); release(); await request;
  expect(api.expanded.value).toBe(false); expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
});

test("view-command retry reuses its own operation and is admission guarded", async () => {
  const wrapper = create(), command = jest.fn().mockRejectedValueOnce(new Error("view failure")).mockResolvedValueOnce();
  await api.run(command); blocked.value = true; await api.retry(); expect(command).toHaveBeenCalledTimes(1);
  blocked.value = false; await api.retry(); expect(command).toHaveBeenCalledTimes(2); wrapper.unmount();
});

test("scope reactivation cannot start a second native request before the stale request settles", async () => {
  const wrapper = create(); let resolve;
  wrapper.element.requestFullscreen.mockImplementationOnce(() => new Promise(done => { resolve = () => { owner = wrapper.element; done(); }; }));
  const held = api.toggle(); active.value = false; active.value = true;
  await api.toggle(); expect(wrapper.element.requestFullscreen).toHaveBeenCalledTimes(1);
  resolve(); await held;
  expect(owner).toBe(null); expect(api.expanded.value).toBe(false); expect(api.pending.value).toBe(false);
  wrapper.unmount();
});

test("another fullscreen element cannot be replaced by this controller", async () => {
  const wrapper = create(); owner = document.createElement("video");
  await api.toggle(); expect(wrapper.element.requestFullscreen).not.toHaveBeenCalled(); wrapper.unmount();
});

test("fullscreen transition stays busy until its current viewport adjustment settles", async () => {
  const wrapper = create(); let release;
  change.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const open = api.toggle(); await nextTick(); await Promise.resolve();
  expect(api.pending.value).toBe(true);
  release(); await open; expect(api.pending.value).toBe(false); wrapper.unmount();
});

test("view adjustment rejection is retried as adjustment, not fullscreen entry", async () => {
  const wrapper = create(); change.mockRejectedValueOnce(new Error("camera unavailable"));
  await api.toggle(); await nextTick();
  expect(api.error.value).toBe("画板视图操作失败，请重试。");
  await api.retry(); expect(change).toHaveBeenCalledTimes(2);
  expect(wrapper.element.requestFullscreen).toHaveBeenCalledTimes(1);
  expect(api.expanded.value).toBe(true); wrapper.unmount();
});

test("fullscreen-entry retry cannot replace another fullscreen owner", async () => {
  const wrapper = create(); wrapper.element.requestFullscreen.mockRejectedValueOnce(new Error("denied"));
  await api.toggle(); owner = document.createElement("video"); await api.retry();
  expect(wrapper.element.requestFullscreen).toHaveBeenCalledTimes(1); wrapper.unmount();
});

test("Escape exits only the owned drawing view and removes its listener on disposal", async () => {
  const wrapper = create(); await api.toggle();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
  await nextTick(); await Promise.resolve(); expect(owner).toBe(null);
  owner = document.createElement("video");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
  wrapper.unmount(); owner = wrapper.element;
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
});

test("failed Escape exit retries exit rather than the previous successful zoom", async () => {
  const wrapper = create(); await api.toggle(); const zoom = jest.fn(); await api.run(zoom);
  document.exitFullscreen.mockRejectedValueOnce(new Error("native exit denied"));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); await Promise.resolve();
  expect(api.error.value).toBe("画板视图操作失败，请重试。");
  await api.retry(); expect(owner).toBe(null); expect(zoom).toHaveBeenCalledTimes(1); wrapper.unmount();
});

test("automatic resize failures retry only their own current camera adjustment", async () => {
  const wrapper = create(); await api.toggle();
  const fit = jest.fn().mockRejectedValueOnce(new Error("resize fit failed")).mockResolvedValueOnce();
  await api.adjustView(fit); expect(api.error.value).toBe("画板视图操作失败，请重试。");
  await api.retry(); expect(fit).toHaveBeenCalledTimes(2); expect(api.expanded.value).toBe(true); wrapper.unmount();
});

test("late automatic resize errors cannot revive after a scope generation change", async () => {
  const wrapper = create(); let fail;
  const held = api.adjustView(() => new Promise((_resolve, reject) => { fail = reject; }));
  active.value = false; active.value = true; fail(new Error("old fit")); await held;
  expect(api.error.value).toBe(""); await api.retry(); wrapper.unmount();
});
