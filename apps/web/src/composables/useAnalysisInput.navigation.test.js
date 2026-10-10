import { defineComponent, h, reactive } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter, RouterLink, RouterView } from "vue-router";
import { API } from "@/common/api";
import { useAnalysisInput } from "./useAnalysisInput";

jest.mock("@/common/api", () => ({ API: { get: jest.fn() } }));
const wrappers = [];
let confirm;

beforeEach(() => {
  // This is a saved-input transport fixture, not chemistry or model output.
  API.get.mockReset().mockImplementation(async (path) => ({
    id: path.split("/").at(-1), kind: "process", status: "completed",
    created: "2026-10-08T00:00:00Z", inputs: { mass: "20" }, result: {},
  }));
  confirm = jest.spyOn(window, "confirm").mockReturnValue(false);
  window.history.replaceState({ position: 3 }, "");
});
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); jest.restoreAllMocks(); });

async function setup({ location = "/process?record=saved", prefill = () => {} } = {}) {
  const form = reactive({ mass: "" });
  let saved;
  const Input = defineComponent({
    setup() {
      saved = useAnalysisInput({ kind: "process", snapshot: () => form,
        clear: () => { form.mass = ""; }, apply: input => { form.mass = input.mass; },
        prefill: (value, query, ready) => prefill(form, value, query, ready) });
      return () => h(RouterLink, { to: "/process", onClickCapture: saved.startNew }, () => "New input");
    },
  });
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: "/process", component: Input },
    { path: "/analyses", component: { render: () => h("div", "History") } },
  ] });
  await router.push(location);
  const wrapper = mount({ render: () => h(RouterView) }, { global: { plugins: [router] } });
  wrappers.push(wrapper); await flushPromises();
  return { router, wrapper, form, saved };
}

test("real router guards preserve edits on cancelled leave/update and hash-only focus navigation", async () => {
  const { router, form } = await setup();
  expect(form.mass).toBe("20");
  form.mass = "12.345";
  await router.push("/process?record=saved#workspace-content"); await flushPromises();
  expect(form.mass).toBe("12.345"); expect(API.get).toHaveBeenCalledTimes(1);
  expect(confirm).not.toHaveBeenCalled();
  await router.push("/process?record=other"); await flushPromises();
  expect(router.currentRoute.value.query.record).toBe("saved");
  expect(form.mass).toBe("12.345"); expect(API.get).toHaveBeenCalledTimes(1);
  await router.push("/analyses");
  expect(router.currentRoute.value.path).toBe("/process"); expect(form.mass).toBe("12.345");
  confirm.mockReturnValue(true); await router.push("/analyses");
  expect(router.currentRoute.value.path).toBe("/analyses");
});

test("a late prefill continuation cannot acknowledge a newer unsubmitted edit", async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const { router, form } = await setup({ location: "/process?smiles=seed", prefill: current => { current.mass = "20"; return pending; } });
  form.mass = "12.345"; finish(); await flushPromises();
  const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  await router.push("/analyses");
  expect(router.currentRoute.value.path).toBe("/process"); expect(form.mass).toBe("12.345");
  expect(confirm).toHaveBeenCalledTimes(1);
});

test("captured New-input cancellation stops the actual link; approval resets once without a second prompt", async () => {
  const { router, wrapper, form } = await setup();
  const pointer = { version: 1, kind: "process", id: "saved", location: "/process?record=saved" };
  window.history.replaceState({ position: 3, xSynthSubmittedInput: pointer }, "");
  form.mass = "12.345";
  await wrapper.get("a").trigger("click"); await flushPromises();
  expect(form.mass).toBe("12.345"); expect(router.currentRoute.value.query.record).toBe("saved");
  expect(window.history.state.xSynthSubmittedInput).toEqual(pointer);
  confirm.mockClear().mockReturnValue(true);
  await wrapper.get("a").trigger("click"); await flushPromises();
  expect(confirm).toHaveBeenCalledTimes(1); expect(form.mass).toBe("");
  expect(router.currentRoute.value.fullPath).toBe("/process");
  expect(window.history.state).toEqual({ position: 3, xSynthSubmittedInput: null });
});

test("reload is explicit, a committed input navigates cleanly, and unmount removes the exact unload listener", async () => {
  const added = jest.spyOn(window, "addEventListener"), removed = jest.spyOn(window, "removeEventListener");
  const { router, form, saved, wrapper } = await setup();
  const listener = added.mock.calls.find(([type]) => type === "beforeunload")[1];
  form.mass = "12.345";
  const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  await saved.reload(); expect(form.mass).toBe("12.345"); expect(API.get).toHaveBeenCalledTimes(1);
  confirm.mockReturnValue(true); await saved.reload();
  expect(form.mass).toBe("20"); expect(API.get).toHaveBeenCalledTimes(2);
  form.mass = "25"; saved.accept(); confirm.mockClear();
  await router.push("/analyses"); expect(confirm).not.toHaveBeenCalled();
  expect(removed).toHaveBeenCalledWith("beforeunload", listener);
  wrapper.unmount();
});
