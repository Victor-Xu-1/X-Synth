import { defineComponent } from "vue";
import { randomUUID } from "node:crypto";
Object.defineProperty(globalThis.crypto, "randomUUID", { value: randomUUID });
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
  await eventually(() => Boolean(state.health.value) || Boolean(state.indexError.value));
  return { state, router, wrapper };
}
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

describe("real API contract", () => {
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

test("actual TestClient cursor pages preserve identities/totals, detail/back, reload and legitimate history", async () => {
  const { state, router } = await setup();
  state.filters.limit = 1;
  await state.search();
  expect(state.matchedCount.value).toBe(3);
  const visited = [state.rows.value[0].template_id];
  const start = api.requests.length;
  await state.nextPage();
  const cursor = router.currentRoute.value.query.cursor;
  expect(typeof cursor).toBe("string");
  expect(cursor.length).toBeGreaterThan(0);
  expect(cursor.length).toBeLessThanOrEqual(2048);
  expect(api.requests.slice(start).find((item) => item.method === "POST").body.cursor).toBe(cursor);
  visited.push(state.rows.value[0].template_id);
  const second = state.rows.value[0], url = router.currentRoute.value.fullPath;
  await state.openTemplate(second);
  await eventually(() => Boolean(state.detail.value));
  expect(state.detail.value.reaction_smarts).toBe(second.reaction_smarts);
  expect(router.currentRoute.value.query.cursor).toBe(cursor);
  await state.backToList();
  expect(state.rows.value).toEqual([second]);
  expect(state.pageNumber.value).toBe(2);
  const reload = await setup(url);
  await eventually(() => reload.state.searched.value);
  expect(reload.state.rows.value).toEqual([second]);
  expect(reload.state.canPrevious.value).toBe(false);
  expect(reload.state.pageNumber.value).toBeNull();
  await state.nextPage();
  visited.push(state.rows.value[0].template_id);
  expect(new Set(visited).size).toBe(3);
  expect(state.matchedCount.value).toBe(3);
  expect(state.canNext.value).toBe(false);
  await state.previousPage();
  expect(router.currentRoute.value.query.cursor).toBe(cursor);
  expect(state.rows.value).toEqual([second]);
  await state.firstPage();
  expect(router.currentRoute.value.query).not.toHaveProperty("cursor");
  expect(state.pageNumber.value).toBe(1);
});

test("actual 422 cursor failure keeps the failing URL and retry body until explicit new search", async () => {
  const { state, router } = await setup("/template?limit=1&searched=1&cursor=invalid");
  await eventually(() => Boolean(state.error.value));
  expect(state.error.value).toContain("模板分页游标无效");
  expect(router.currentRoute.value.query.cursor).toBe("invalid");
  expect(state.searched.value).toBe(false);
  await state.retrySearch();
  expect(state.error.value).toContain("模板分页游标无效");
  expect(api.requests.at(-1).body.cursor).toBe("invalid");
  await state.search();
  expect(state.error.value).toBe("");
  expect(state.rows.value).toHaveLength(1);
  expect(state.matchedCount.value).toBe(3);
  expect(router.currentRoute.value.query).not.toHaveProperty("cursor");
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
  state.filters.minCount = 2147483647;
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
  expect(state.coverageReason.value).toBe("");
  expect(state.rows.value).toEqual([]);
});

test("repeated form submissions remain single-flight during router navigation and query loading", async () => {
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
});

describe("isolated cursor state", () => {
  const record = (id, count) => ({
    source: "isolated", template_id: `isolated:${id}`, count, direction: "retro",
    reaction_smarts: "[C:1]=[O:2]>>[C:1]-[O:2]",
  });
  const a = record("a", 12), b = record("b", 11), c = record("c", 10);
  const firstPage = { count: 2, templates: [a, b], matched_count: 3, next_cursor: "opaque+/=b", has_more: true };
  const lastPage = { count: 1, templates: [c], matched_count: 3, next_cursor: null, has_more: false };
  let client;
  beforeEach(() => {
    client = {
      get: jest.fn().mockResolvedValue({ status: "ready", template_count: 100, source_count: 1, directions: { retro: 100 }, sources: ["isolated"] }),
      post: jest.fn().mockImplementation(async (_, body) => body.cursor ? lastPage : firstPage),
    };
  });
  test("next, previous and first each fetch a real page body and keep only the current cursor in the URL", async () => {
    const { state, router } = await setup("/template?limit=2&searched=1", client);
    await flushPromises();
    expect(state.matchedCount.value).toBe(3);
    expect(state.pageNumber.value).toBe(1);
    await state.nextPage();
    expect(client.post.mock.calls[1][1].cursor).toBe("opaque+/=b");
    expect(state.rows.value).toEqual([c]);
    expect(state.pageNumber.value).toBe(2);
    expect(state.canPrevious.value).toBe(true);
    expect(router.currentRoute.value.query.cursor).toBe("opaque+/=b");
    expect(router.currentRoute.value.query).not.toHaveProperty("page");
    await state.previousPage();
    expect(client.post.mock.calls[2][1]).not.toHaveProperty("cursor");
    expect(state.rows.value).toEqual([a, b]);
    await state.nextPage();
    await state.firstPage();
    expect(client.post).toHaveBeenCalledTimes(5);
    expect(router.currentRoute.value.query).not.toHaveProperty("cursor");
  });
  test("direct reload has no invented predecessor or page number; retry preserves its opaque cursor", async () => {
    const { state, router } = await setup("/template?limit=2&searched=1&cursor=opaque%2B%2F%3Db", client);
    await flushPromises();
    expect(state.rows.value).toEqual([c]);
    expect(state.pageNumber.value).toBeNull();
    expect(state.canPrevious.value).toBe(false);
    await state.previousPage();
    expect(client.post).toHaveBeenCalledTimes(1);
    await state.retrySearch();
    expect(client.post.mock.calls[1][1].cursor).toBe("opaque+/=b");
    expect(router.currentRoute.value.query.cursor).toBe("opaque+/=b");
  });
  test("browser back/forward refetch the actual cursor without altering submitted filters", async () => {
    const { state, router } = await setup("/template?limit=2&searched=1", client);
    await flushPromises();
    await state.nextPage();
    router.back();
    await flushPromises();
    expect(state.rows.value).toEqual([a, b]);
    expect(client.post).toHaveBeenCalledTimes(3);
    router.forward();
    await flushPromises();
    expect(state.rows.value).toEqual([c]);
    expect(client.post.mock.calls[3][1].cursor).toBe("opaque+/=b");
    expect(state.filters.limit).toBe(2);
  });
  test("browser back to an unsearched location clears results and pager without making a query", async () => {
    const { state, router } = await setup("/template", client);
    state.filters.limit = 2;
    await state.search();
    const requests = client.post.mock.calls.length;
    router.back();
    await flushPromises();
    expect(state.rows.value).toEqual([]);
    expect(state.searched.value).toBe(false);
    expect(state.showPagination.value).toBe(false);
    expect(client.post).toHaveBeenCalledTimes(requests);
  });
  test.each([409, 422])("HTTP %i remains a failed page, never an empty result or silent rewind", async (status) => {
    client.post.mockRejectedValueOnce(new Error(JSON.stringify({ detail: `cursor failure ${status}` })));
    const { state, router } = await setup("/template?limit=2&searched=1&cursor=opaque%2B%2F%3Db", client);
    await flushPromises();
    expect(state.error.value).toContain(String(status));
    expect(state.searched.value).toBe(false);
    expect(state.rows.value).toEqual([]);
    expect(router.currentRoute.value.query.cursor).toBe("opaque+/=b");
    await state.retrySearch();
    expect(client.post.mock.calls[1][1].cursor).toBe("opaque+/=b");
    await state.search();
    expect(client.post.mock.calls[2][1]).not.toHaveProperty("cursor");
    expect(router.currentRoute.value.query).not.toHaveProperty("cursor");
  });
  test("editing filters invalidates page history and results; an explicit search rewinds", async () => {
    const { state, router } = await setup("/template?limit=2&searched=1", client);
    await flushPromises();
    await state.nextPage();
    state.filters.minCount = 1;
    expect(state.rows.value).toEqual([]);
    expect(state.canNext.value).toBe(false);
    expect(state.canPrevious.value).toBe(false);
    await state.search();
    expect(client.post.mock.calls[2][1]).toMatchObject({ min_count: 1 });
    expect(client.post.mock.calls[2][1]).not.toHaveProperty("cursor");
    expect(router.currentRoute.value.query.min_count).toBe("1");
  });
  test("malformed cursor and repeated filter parameters are errors before any POST", async () => {
    const { state } = await setup({ path: "/template", query: { limit: "2", searched: "1", cursor: ["a", "b"] } }, client);
    await flushPromises();
    expect(state.error.value).not.toBe("");
    expect(client.post).not.toHaveBeenCalled();
    const invalid = await setup({ path: "/template", query: { limit: ["1", "2"], searched: "1" } }, client);
    await flushPromises();
    expect(invalid.state.error.value).not.toBe("");
    expect(client.post).not.toHaveBeenCalled();
  });
  test("control-bearing URL cursor fails before any query and cannot silently rewind", async () => {
    const { state, router } = await setup({ path: "/template", query: { limit: "2", cursor: "opaque\x7fcursor" } }, client);
    await flushPromises();
    expect(state.error.value).toContain("模板分页游标无效");
    expect(client.post).not.toHaveBeenCalled();
    expect(router.currentRoute.value.query.cursor).toBe("opaque\x7fcursor");
    expect(state.searched.value).toBe(false);
  });
  test("whitespace-bearing API next cursor is never published as a navigable page", async () => {
    client.post.mockResolvedValueOnce({ ...firstPage, next_cursor: "opaque cursor" });
    const { state, router } = await setup("/template?limit=2&searched=1", client);
    await flushPromises();
    expect(state.error.value).toContain("模板分页响应无效");
    expect(state.rows.value).toEqual([]);
    expect(state.canNext.value).toBe(false);
    await state.nextPage();
    expect(client.post).toHaveBeenCalledTimes(1);
    expect(router.currentRoute.value.query).not.toHaveProperty("cursor");
  });
  test("repeated paging stays single-flight and unmount invalidates a delayed response", async () => {
    const { state, wrapper } = await setup("/template?limit=2&searched=1", client);
    await flushPromises();
    let release;
    client.post.mockImplementationOnce(() => new Promise((yes) => { release = yes; }));
    const pending = state.nextPage();
    await flushPromises();
    await state.nextPage();
    await state.previousPage();
    expect(client.post).toHaveBeenCalledTimes(2);
    expect(state.busy.value).toBe(true);
    wrapper.unmount();
    release(lastPage);
    await pending;
    expect(state.rows.value).toEqual([]);
  });
  test("a superseded cursor request cannot finish a newer page or hide its error", async () => {
    const { state, router } = await setup("/template?limit=2&searched=1", client);
    await flushPromises();
    let release;
    client.post.mockImplementationOnce(() => new Promise((yes) => { release = yes; }));
    const pending = state.nextPage();
    await flushPromises();
    client.post.mockRejectedValueOnce(new Error(JSON.stringify({ detail: "new page unavailable" })));
    await router.push("/template?limit=2&searched=1&cursor=other");
    await flushPromises();
    release(lastPage);
    await pending;
    expect(state.error.value).toBe("new page unavailable");
    expect(state.rows.value).toEqual([]);
    expect(state.loading.value).toBe(false);
  });
});

describe("index and detail response boundary", () => {
  const health = { status: "ready", template_count: 1, source_count: 1, sources: ["isolated"], directions: { retro: 1 } };
  const detail = { source: "isolated", template_id: "isolated:a", template_set: "isolated", count: 1,
    reaction_smarts: "[C:1]=[O:2]>>[C:1]-[O:2]", direction: "retro", domain: "strict_synthesis",
    necessary_reagent: "", intra_only: false, dimer_only: false, attributes: {}, references: [], raw: {} };
  test.each([{}, { ...health, status: "unavailable" }, { ...health, source_count: 2 },
    { ...health, directions: [] }, { ...health, directions: { retro: "1" } }])(
    "invalid index %j cannot enable template queries", async value => {
      const client = { get: jest.fn().mockResolvedValue(value), post: jest.fn() };
      const { state } = await setup("/template?searched=1", client);
      await flushPromises();
      expect(state.canSearch.value).toBe(false);
      expect(state.health.value).toBeNull();
      expect(state.indexError.value).toBeTruthy();
      expect(client.post).not.toHaveBeenCalled();
    },
  );
  test("an explicit index retry restores the same idle input without posting a query", async () => {
    const client = { get: jest.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(health), post: jest.fn() };
    const { state, router } = await setup("/template?filter_source=isolated&min_count=7&limit=3", client);
    const before = { ...state.filters };
    expect(state.canSearch.value).toBe(false);
    await state.loadHealth();
    expect(state.canSearch.value).toBe(true);
    expect(state.filters).toEqual(before);
    expect(state.indexError.value).toBe("");
    expect(router.currentRoute.value.query.min_count).toBe("7");
    expect(client.post).not.toHaveBeenCalled();
  });
  test("disposed detail and index retries do not send requests or reopen loading state", async () => {
    const client = { get: jest.fn().mockImplementation(async path => path.endsWith("/health") ? health : { template: detail }), post: jest.fn() };
    const { state, wrapper } = await setup("/template?source=isolated&id=isolated:a", client);
    await flushPromises();
    expect(state.detail.value).toEqual(detail);
    wrapper.unmount();
    const requests = client.get.mock.calls.length;
    await state.loadDetail();
    await state.loadHealth();
    expect(client.get).toHaveBeenCalledTimes(requests);
    expect(state.detailLoading.value).toBe(false);
    expect(state.healthLoading.value).toBe(false);
  });
  test.each(["attributes", "references", "raw"])("null %s cannot enter template rendering", async field => {
    const client = { get: jest.fn().mockImplementation(async path => path.endsWith("/health") ? health : { template: { ...detail, [field]: null } }), post: jest.fn() };
    const { state } = await setup("/template?source=isolated&id=isolated:a", client);
    await flushPromises();
    expect(state.detail.value).toBeNull();
    expect(state.detailError.value).toBeTruthy();
    expect(state.detailLoading.value).toBe(false);
    expect(client.post).not.toHaveBeenCalled();
  });
});
