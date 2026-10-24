import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import RoutePreview from "./RoutePreview.vue";
import RouteReader from "./RouteReader.vue";
import WorkbenchDialog from "@/components/workspace/WorkbenchDialog.vue";
import { setLocale } from "@/i18n";
import { API } from "@/common/api";

jest.mock("vue-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("./RouteReader.vue", () => ({ props: ["candidates"], template: '<div class="actual-reader-boundary" />' }));
jest.mock("@/common/api", () => ({ API: { post: jest.fn() } }));
const stubs = {
  VDefaultsProvider: { template: "<slot />" },
  VDialog: { props: ["modelValue"], template: '<div v-if="modelValue" role="dialog"><slot /></div>' },
  VCard: { template: '<section><slot /></section>' },
  VBtn: { props: ["to"], template: '<button :data-to="to"><slot /></button>' },
};

test("preview dialog has a real heading name and keeps source-owned title across languages", async () => {
  const title = "原始路线名称", candidates = [{ route_id: "r", steps: [] }];
  const wrapper = mount(RoutePreview, { props: { modelValue: true, title, candidates, jobId: "task-a" }, global: { stubs } });
  expect(wrapper.get('[role="dialog"]').attributes("aria-labelledby")).toBe(wrapper.get("h2").attributes("id"));
  setLocale("en", { persist: false }); await nextTick();
  expect(wrapper.get("h2").text()).toBe(title);
  expect(wrapper.text()).toContain("Open details");
  await wrapper.get('[aria-label="Close preview"]').trigger("click");
  expect(wrapper.emitted("update:modelValue")).toEqual([[false]]);
  await wrapper.setProps({ modelValue: false });
  wrapper.findComponent(WorkbenchDialog).vm.$emit("afterLeave");
  expect(wrapper.emitted("afterLeave")).toEqual([[null]]);
  wrapper.unmount();
});

test("leave carries the immutable presentation ticket, not a later prop replacement", async () => {
  const wrapper = mount(RoutePreview, { props: { modelValue: true, focusTicket: 7 }, global: { stubs } });
  await wrapper.setProps({ modelValue: false, focusTicket: 9 });
  wrapper.findComponent(WorkbenchDialog).vm.$emit("afterLeave");
  expect(wrapper.emitted("afterLeave")).toEqual([[7]]);
  wrapper.unmount();
});

test("intentional navigation emits its release before closing the preview", async () => {
  const events = [];
  const wrapper = mount(RoutePreview, { props: { modelValue: true, jobId: "task-a", detailQuery: { history_query: "CCO" },
    onNavigate: () => events.push("navigate"), "onUpdate:modelValue": value => events.push(value) }, global: { stubs } });
  await wrapper.get('button[data-to]').trigger("click");
  expect(events).toEqual(["navigate", false]);
  wrapper.unmount();
});

test.each(["en", "zh-CN"])("copy uses the active %s language, not the language when preview opened", async locale => {
  setLocale(locale === "en" ? "zh-CN" : "en", { persist: false });
  const jobId = "a".repeat(32), routeId = "askcos_mcts:preview-source";
  const candidates = [{ route_id: routeId, steps: [] }], before = JSON.stringify(candidates);
  API.post.mockReset();
  API.post.mockResolvedValue({ id: "b".repeat(32) });
  const wrapper = mount(RoutePreview, { props: { modelValue: true, jobId, candidates, originalIndices: [7] }, global: { stubs } });
  try {
    setLocale(locale, { persist: false });
    await nextTick();
    wrapper.getComponent(RouteReader).vm.$emit("edit", routeId);
    await flushPromises();
    expect(API.post).toHaveBeenCalledTimes(1);
    expect(API.post).toHaveBeenCalledWith("/api/v1/route-documents/from-task", {
      job_id: jobId, route_index: 7, route_id: routeId, locale,
    });
    expect(JSON.stringify(candidates)).toBe(before);
  } finally { wrapper.unmount(); }
});
