import { defineComponent } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import TemplateDetails from "@/components/templates/TemplateDetails.vue";
import { templateDetailLocation } from "@/common/template-detail";
import {
  holdContractResponses,
  templateContractApi,
} from "@/common/template-detail.test-support";
import { useTemplateSearch } from "./useTemplateSearch";

jest.setTimeout(30000);
let api, native, other;
const wrappers = [];
const detailPath = "/api/v1/template-library/template";
async function eventually(predicate) {
  const deadline = Date.now() + 10000;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((yes) => setTimeout(yes, 10));
    await flushPromises();
  }
  expect(predicate()).toBe(true);
}
async function setup(location = "/template", client = api) {
  let state;
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/template", component: { render: () => null } }],
  });
  await router.push(location);
  await router.isReady();
  const wrapper = mount(
    defineComponent({
      setup() {
        state = useTemplateSearch({ api: client });
        return () => null;
      },
    }),
    { global: { plugins: [router] } },
  );
  wrappers.push(wrapper);
  return { state, router, wrapper };
}
beforeAll(async () => {
  api = templateContractApi();
  native = (
    await api.get(detailPath, {
      source: "reference_main",
      template_id: "reference_main:example-0",
    })
  ).template;
  other = (
    await api.post("/api/v1/template-library/query", {
      sources: ["reference_variants"],
      limit: 1,
    })
  ).templates[0];
});
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));
afterAll(async () => {
  await api.stop();
});

test("plain mount reads health only and never queries templates or predicts", async () => {
  const start = api.requests.length,
    { state } = await setup();
  await eventually(() => Boolean(state.health.value));
  expect(
    api.requests.slice(start).map((item) => [item.method, item.path]),
  ).toEqual([["GET", "/api/v1/template-library/health"]]);
  expect(state.detail.value).toBeNull();
  expect(state.searched.value).toBe(false);
});

test("deep-link reload fetches exactly its real source-scoped record without prediction", async () => {
  const start = api.requests.length,
    { state } = await setup(templateDetailLocation(native));
  await eventually(() => Boolean(state.detail.value));
  expect(state.detail.value.raw).toEqual(native.raw);
  expect(
    api.requests
      .slice(start)
      .every(
        (item) =>
          item.method === "GET" &&
          item.path.startsWith("/api/v1/template-library/"),
      ),
  ).toBe(true);
});

test("row drill-down, back and URL reload preserve criteria and bounded results", async () => {
  const { state, router, wrapper } = await setup();
  Object.assign(state.filters, {
    source: "reference_variants",
    direction: "retro",
    minCount: 2,
    limit: 2,
  });
  const start = api.requests.length;
  await state.search();
  expect(state.rows.value).toHaveLength(2);
  expect(
    api.requests.slice(start).filter((item) => item.method === "POST"),
  ).toHaveLength(1);
  const rows = [...state.rows.value],
    filters = { ...state.filters };
  await state.openTemplate(rows[0]);
  await eventually(() => Boolean(state.detail.value));
  expect(router.currentRoute.value.query.id).toBe(rows[0].template_id);
  const url = router.currentRoute.value.fullPath;
  await state.backToList();
  expect(state.filters).toEqual(filters);
  expect(state.rows.value).toEqual(rows);
  expect(
    api.requests.slice(start).filter((item) => item.method === "POST"),
  ).toHaveLength(1);
  wrapper.unmount();
  const reload = await setup(url);
  await eventually(() => Boolean(reload.state.detail.value));
  expect(reload.state.filters).toEqual(filters);
  await reload.state.backToList();
  await eventually(() => reload.state.searched.value);
  expect(reload.state.rows.value).toEqual(rows);
});

test("out-of-order real detail completion cannot replace B or end its loading state", async () => {
  const held = holdContractResponses(api, (_, path) => path === detailPath);
  const { state, router } = await setup(templateDetailLocation(native), held);
  await eventually(() => held.held[0]?.ready);
  await router.push(templateDetailLocation(other));
  await eventually(() => held.held[1]?.ready);
  held.held[0].release();
  await flushPromises();
  expect(state.detailLoading.value).toBe(true);
  expect(state.detail.value).toBeNull();
  held.held[1].release();
  await eventually(() => Boolean(state.detail.value));
  expect(state.detail.value.template_id).toBe(other.template_id);
});

test("an old real 404 cannot replace a newer successful detail", async () => {
  const held = holdContractResponses(
    api,
    (_, path, params) =>
      path === detailPath && params.template_id === "reference_main:absent",
  );
  const { state, router } = await setup(
    {
      path: "/template",
      query: { source: "reference_main", id: "reference_main:absent" },
    },
    held,
  );
  await eventually(() => held.held[0]?.ready);
  await router.push(templateDetailLocation(native));
  await eventually(() => Boolean(state.detail.value));
  held.held[0].release();
  await flushPromises();
  expect(state.detail.value.template_id).toBe(native.template_id);
  expect(state.detailError.value).toBe("");
});

test("back and unmount invalidate pending real details", async () => {
  const held = holdContractResponses(api, (_, path) => path === detailPath);
  const { state, wrapper } = await setup(templateDetailLocation(native), held);
  await eventually(() => held.held[0]?.ready);
  await state.backToList();
  held.held[0].release();
  await flushPromises();
  expect(state.detail.value).toBeNull();
  expect(state.detailLoading.value).toBe(false);
  await state.openTemplate(native);
  await eventually(() => held.held[1]?.ready);
  wrapper.unmount();
  held.held[1].release();
  await flushPromises();
  expect(state.detail.value).toBeNull();
});

test("invalid deep links are errors without a detail call; actual 404 supports explicit retry", async () => {
  const start = api.requests.length;
  const invalid = await setup({
    path: "/template",
    query: { source: "reference_main", id: "3325" },
  });
  expect(invalid.state.detailError.value).not.toBe("");
  expect(
    api.requests.slice(start).filter((item) => item.path === detailPath),
  ).toHaveLength(0);
  const missing = await setup({
    path: "/template",
    query: { source: "reference_main", id: "reference_main:absent" },
  });
  await eventually(() => Boolean(missing.state.detailError.value));
  expect(missing.state.detail.value).toBeNull();
  await missing.state.loadDetail();
  expect(missing.state.detailError.value).toContain("没有对应模板");
});

test("adding an empty id to a list URL cannot leave a blank detail state", async () => {
  const { state, router } = await setup();
  await router.push({ path: "/template", query: { id: null } });
  expect(state.isDetail.value).toBe(true);
  expect(state.detailLoading.value).toBe(false);
  expect(state.detailError.value).not.toBe("");
});

test("stale real list responses cannot finish a later search or expose old rows", async () => {
  const held = holdContractResponses(api, (method) => method === "post");
  const { state } = await setup("/template", held);
  state.filters.limit = 1;
  const first = state.search();
  await eventually(() => held.held[0]?.ready);
  state.filters.direction = "forward";
  const second = state.search();
  await eventually(() => held.held[1]?.ready);
  held.held[0].release();
  await first;
  expect(state.loading.value).toBe(true);
  expect(state.rows.value).toEqual([]);
  held.held[1].release();
  await second;
  expect(state.loading.value).toBe(false);
  expect(state.searched.value).toBe(true);
  expect(state.rows.value).toEqual([]);
});

test("repeated form submissions remain single-flight during router replacement and query loading", async () => {
  const held = holdContractResponses(api, (method) => method === "post");
  const { state } = await setup("/template", held);
  state.filters.limit = 1;
  const first = state.search();
  const whileNavigating = state.search();
  await eventually(() => held.held[0]?.ready);
  const whileLoading = state.search();
  await flushPromises();
  try {
    expect(held.held).toHaveLength(1);
  } finally {
    held.held.forEach((entry) => entry.release());
    await Promise.all([first, whileNavigating, whileLoading]);
  }
});

test("real details render SMARTS/provenance/attributes and page numeric references without links", async () => {
  const wrapper = mount(TemplateDetails, { props: { template: native } });
  wrappers.push(wrapper);
  expect(wrapper.find("pre").text()).toBe(native.reaction_smarts);
  expect(wrapper.text()).toContain(String(native.raw.index));
  expect(wrapper.text()).toContain(native.raw._id);
  expect(wrapper.text()).toContain("ring_delta");
  expect(wrapper.findAll(".template-references li")).toHaveLength(50);
  expect(wrapper.findAll("a")).toHaveLength(0);
  await wrapper.find('[aria-label="下一页"]').trigger("click");
  expect(wrapper.findAll(".template-references li")).toHaveLength(
    native.references.length - 50,
  );
  await wrapper.setProps({ template: other });
  expect(wrapper.find("ol").attributes("start")).toBe("1");
  expect(wrapper.findAll("a")).toHaveLength(0);
});
