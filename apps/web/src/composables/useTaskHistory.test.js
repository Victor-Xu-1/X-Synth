import { defineComponent } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createMemoryHistory, createRouter, useRoute } from "vue-router";
import { useTaskHistory } from "./useTaskHistory";

const row = (id = "task-a", patch = {}) => ({
  result_id: id,
  description: id,
  target_smiles: "CCO",
  revision: 7,
  history_revision: 3,
  group_id: null,
  archived: false,
  result_state: "completed",
  num_trees: 3,
  ...patch,
});
const data = (results = [row()], total = results.length) => ({
  results,
  total,
  all_total: 57,
  ungrouped_total: 32,
  groups: [{ id: "g-1", name: "项目", revision: 2, count: 25 }],
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const wrappers = [];
async function setup(
  api = { get: jest.fn().mockResolvedValue(data()) },
  url = "/results",
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/results", component: { render: () => null } }],
  });
  await router.push(url);
  let state;
  const wrapper = mount(
    defineComponent({
      setup() {
        state = useTaskHistory({ api, router, route: useRoute() });
        return () => null;
      },
    }),
    { global: { plugins: [router] } },
  );
  wrappers.push(wrapper);
  await flushPromises();
  return { state, router, api, wrapper };
}
beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  jest.useRealTimers();
});

test("mount makes one bounded server-page request and never loads the whole library", async () => {
  const { api, state } = await setup();
  expect(api.get.mock.calls).toEqual([
    [
      "/api/v1/results/page",
      {
        limit: 24,
        offset: 0,
        query: "",
        status: "all",
        group: "all",
        archived: false,
      },
    ],
  ]);
  expect(state.total.value).toBe(1);
  expect(state.allTotal.value).toBe(57);
  expect(state.ungroupedTotal.value).toBe(32);
  expect(state.groups.value[0].count).toBe(25);
  expect(state.loaded.value).toBe(true);
  expect(state.more.value).toBe(false);
});
test("all URL controls take priority on refresh; no page-local filtering discards server matches", async () => {
  const api = {
    get: jest
      .fn()
      .mockResolvedValue(
        data(
          [row("backend-match", { result_state: "searching", archived: true })],
          49,
        ),
      ),
  };
  const { state } = await setup(
    api,
    "/results?page=2&query=amine&status=active&group=g-1&view=list&archived=true",
  );
  expect(api.get.mock.calls[0][1]).toEqual({
    limit: 24,
    offset: 24,
    query: "amine",
    status: "active",
    group: "g-1",
    archived: true,
  });
  expect(state.rows.value).toHaveLength(1);
  expect(state.view.value).toBe("list");
  expect(state.pageCount.value).toBe(3);
});
test("search debounces 300 ms, resets page, invalidates old requests immediately and persists exact SMILES", async () => {
  const old = deferred();
  const api = {
    get: jest
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue(data([row("new-match")], 1)),
  };
  const { state, router } = await setup(api, "/results?page=2");
  state.query.value = "[NH3+]CC.[Cl-]";
  expect(state.page.value).toBe(0);
  expect(state.loading.value).toBe(true);
  old.resolve(data([row("old-page")], 25));
  await flushPromises();
  expect(state.rows.value).toEqual([]);
  expect(state.loading.value).toBe(true);
  jest.advanceTimersByTime(299);
  await flushPromises();
  expect(api.get).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(1);
  await flushPromises();
  expect(api.get).toHaveBeenCalledTimes(2);
  expect(api.get.mock.calls[1][1].query).toBe("[NH3+]CC.[Cl-]");
  expect(router.currentRoute.value.query).toEqual({ query: "[NH3+]CC.[Cl-]" });
  expect(state.rows.value[0].result_id).toBe("new-match");
});
test("only the latest query issues a request and back navigation cancels a pending edit", async () => {
  const { state, api, router } = await setup();
  state.query.value = "first";
  jest.advanceTimersByTime(200);
  state.query.value = "second";
  jest.advanceTimersByTime(299);
  expect(api.get).toHaveBeenCalledTimes(1);
  await router.push("/results?query=restored&status=failed&view=list");
  await flushPromises();
  jest.advanceTimersByTime(300);
  await flushPromises();
  expect(api.get).toHaveBeenCalledTimes(2);
  expect(state.query.value).toBe("restored");
  router.back();
  await flushPromises();
  expect(state.query.value).toBe("");
  expect(state.status.value).toBe("all");
  expect(state.view.value).toBe("cards");
  expect(api.get.mock.calls.at(-1)[1].query).toBe("");
});
test.each(["resolve", "reject"])(
  "a stale page %s cannot overwrite data, errors, or loading",
  async (mode) => {
    const old = deferred(),
      current = deferred();
    const api = {
      get: jest
        .fn()
        .mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(current.promise),
    };
    const { state } = await setup(api);
    state.status.value = "active";
    old[mode](
      mode === "resolve" ? data([row("old")]) : new Error("old failure"),
    );
    await flushPromises();
    expect(state.loading.value).toBe(true);
    expect(state.error.value).toBe("");
    expect(state.rows.value).toEqual([]);
    current.resolve(data([row("current", { result_state: "searching" })]));
    await flushPromises();
    expect(state.rows.value[0].result_id).toBe("current");
    expect(state.loading.value).toBe(false);
  },
);
test("page/group/recycle-bin transitions clear selection and keep server query context", async () => {
  const { state, api, router } = await setup({
    get: jest.fn().mockResolvedValue(data([row()], 49)),
  });
  state.togglePage(true);
  expect(state.allSelected.value).toBe(true);
  state.nextPage();
  await flushPromises();
  expect(state.selection.value).toEqual([]);
  expect(api.get.mock.calls.at(-1)[1].offset).toBe(24);
  state.toggleTask(state.rows.value[0], true);
  state.chooseGroup("g-1");
  await flushPromises();
  expect(state.selection.value).toEqual([]);
  expect(state.page.value).toBe(0);
  state.togglePage(true);
  state.chooseArchive();
  await flushPromises();
  expect(state.selection.value).toEqual([]);
  expect(router.currentRoute.value.query).toEqual({ archived: "true" });
  expect(api.get.mock.calls.at(-1)[1]).toMatchObject({
    group: "all",
    archived: true,
  });
});
test("view changes persist without fetching or clearing current selection", async () => {
  const { state, api, router } = await setup();
  state.togglePage(true);
  state.view.value = "list";
  await flushPromises();
  expect(api.get).toHaveBeenCalledTimes(1);
  expect(state.selection.value).toHaveLength(1);
  expect(router.currentRoute.value.query).toEqual({ view: "list" });
});

test("browser back restores previous pagination and groups from real navigation history", async () => {
  const { state, router, api } = await setup({
    get: jest.fn().mockResolvedValue(data([row()], 49)),
  });
  await state.nextPage();
  await flushPromises();
  expect(state.page.value).toBe(1);
  expect(router.currentRoute.value.query.page).toBe("2");
  await state.chooseGroup("g-1");
  await flushPromises();
  expect(state.page.value).toBe(0);
  expect(state.group.value).toBe("g-1");
  router.back();
  await flushPromises();
  expect(state.group.value).toBe("all");
  expect(state.page.value).toBe(1);
  expect(api.get.mock.calls.at(-1)[1]).toMatchObject({
    offset: 24,
    group: "all",
  });
  router.back();
  await flushPromises();
  expect(state.page.value).toBe(0);
});

test("a pending last-page correction removes previous page rows until the legal page arrives", async () => {
  const last = deferred();
  const api = {
    get: jest
      .fn()
      .mockResolvedValueOnce(data([row("old-page")], 49))
      .mockResolvedValueOnce(data([], 1))
      .mockReturnValueOnce(last.promise),
  };
  const { state } = await setup(api, "/results?page=3");
  const pending = state.refresh();
  await flushPromises();
  expect(state.page.value).toBe(0);
  expect(state.rows.value).toEqual([]);
  expect(state.loaded.value).toBe(false);
  expect(state.loading.value).toBe(true);
  last.resolve(data([row("legal-page")], 1));
  await pending;
  expect(state.rows.value[0].result_id).toBe("legal-page");
});
test("a shrinking library falls back once to its valid last page and fixes the URL", async () => {
  const api = {
    get: jest
      .fn()
      .mockResolvedValueOnce(data([], 25))
      .mockResolvedValueOnce(data([row("last")], 25)),
  };
  const { state, router } = await setup(api, "/results?page=9&query=CCO");
  expect(api.get.mock.calls.map((call) => call[1].offset)).toEqual([192, 24]);
  expect(router.currentRoute.value.query).toEqual({ page: "2", query: "CCO" });
  expect(state.page.value).toBe(1);
  expect(state.rows.value[0].result_id).toBe("last");
});
test("repeated shrinkage is bounded, visible, and cannot leave stale selections actionable", async () => {
  const api = {
    get: jest
      .fn()
      .mockResolvedValueOnce(data([], 49))
      .mockResolvedValueOnce(data([], 1)),
  };
  const { state } = await setup(api, "/results?page=9");
  expect(api.get).toHaveBeenCalledTimes(2);
  expect(state.error.value).toContain("重新读取");
  expect(state.loaded.value).toBe(false);
  expect(state.rows.value).toEqual([]);
});
test("polling preserves filters and unchanged metadata selection, but invalidates changed metadata", async () => {
  const active = row("running", { result_state: "searching" });
  const api = {
    get: jest
      .fn()
      .mockResolvedValueOnce(data([active]))
      .mockResolvedValueOnce(data([{ ...active, revision: 8, num_trees: 4 }]))
      .mockResolvedValueOnce(
        data([
          {
            ...active,
            revision: 9,
            history_revision: 4,
            description: "new-name",
          },
        ]),
      ),
  };
  const { state, router } = await setup(
    api,
    "/results?query=CCO&status=active&group=ungrouped",
  );
  state.togglePage(true);
  const selected = [...state.selection.value];
  jest.advanceTimersByTime(6000);
  await flushPromises();
  expect(state.selection.value).toEqual(selected);
  expect(state.rows.value[0].num_trees).toBe(4);
  expect(api.get.mock.calls[1][1]).toMatchObject({
    query: "CCO",
    status: "active",
    group: "ungrouped",
  });
  jest.advanceTimersByTime(6000);
  await flushPromises();
  expect(state.selection.value).toEqual([]);
  expect(state.rows.value[0].description).toBe("new-name");
  expect(router.currentRoute.value.query).toEqual({
    query: "CCO",
    status: "active",
    group: "ungrouped",
  });
});

test("background polling preserves interactive history and cannot overlap; an explicit refresh still locks controls", async () => {
  const active = row("running", { result_state: "searching" }), background = deferred(), foreground = deferred();
  const api = { get: jest.fn().mockResolvedValueOnce(data([active]))
    .mockReturnValueOnce(background.promise).mockReturnValueOnce(foreground.promise) };
  const { state } = await setup(api);
  state.togglePage(true);
  jest.advanceTimersByTime(6000);
  await flushPromises();
  expect(state.loading.value).toBe(false);
  expect(state.selection.value).toHaveLength(1);
  jest.advanceTimersByTime(6000);
  await flushPromises();
  expect(api.get).toHaveBeenCalledTimes(2);
  background.resolve(data([{ ...active, revision: 8, num_trees: 4 }]));
  await flushPromises();
  expect(state.rows.value[0].num_trees).toBe(4);
  const manual = state.refresh();
  expect(state.loading.value).toBe(true);
  foreground.resolve(data([active]));
  await manual;
  expect(state.loading.value).toBe(false);
});

test("a background history failure remains visible and stops polling until an explicit retry", async () => {
  const active = row("running", { result_state: "searching" });
  const api = { get: jest.fn().mockResolvedValueOnce(data([active]))
    .mockRejectedValueOnce(new Error(JSON.stringify({ detail: "History temporarily unavailable" })))
    .mockResolvedValueOnce(data([active])) };
  const { state } = await setup(api);
  jest.advanceTimersByTime(6000);
  await flushPromises();
  expect(state.error.value).toContain("History temporarily unavailable");
  expect(state.rows.value).toHaveLength(1);
  jest.advanceTimersByTime(18000);
  await flushPromises();
  expect(api.get).toHaveBeenCalledTimes(2);
  expect(await state.refresh()).toBe(true);
  expect(state.error.value).toBe("");
});
test.each(["resolve", "reject"])(
  "unmount cancels debounce/poll and ignores late %s without another request",
  async (mode) => {
    const request = deferred();
    const { state, wrapper, api } = await setup({
      get: jest.fn().mockReturnValue(request.promise),
    });
    state.query.value = "pending";
    wrapper.unmount();
    request[mode](mode === "resolve" ? data() : new Error("late error"));
    await flushPromises();
    jest.advanceTimersByTime(12000);
    expect(state.rows.value).toEqual([]);
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(await state.refresh()).toBe(false);
  },
);

test("explicit refresh flushes a pending search into the URL and fetches it exactly once", async () => {
  const { state, api, router } = await setup();
  state.query.value = "fresh-query";
  await state.refresh();
  await flushPromises();
  jest.advanceTimersByTime(300);
  await flushPromises();
  expect(api.get).toHaveBeenCalledTimes(2);
  expect(api.get.mock.calls[1][1].query).toBe("fresh-query");
  expect(router.currentRoute.value.query.query).toBe("fresh-query");
});
test("empty results, errors, malformed snapshots and invalid URL context stay distinct", async () => {
  const { state, api } = await setup({
    get: jest.fn().mockResolvedValue(data([], 0)),
  });
  expect(state.loaded.value).toBe(true);
  expect(state.total.value).toBe(0);
  expect(state.error.value).toBe("");
  api.get.mockResolvedValueOnce({ results: [] });
  await state.refresh();
  expect(state.error.value).toContain("格式无效");
  api.get.mockRejectedValueOnce(
    new Error(JSON.stringify({ detail: "owned record missing" })),
  );
  await state.refresh();
  expect(state.error.value).toContain("owned record missing");
  const invalid = await setup({ get: jest.fn() }, "/results?page=NaN");
  expect(invalid.api.get).not.toHaveBeenCalled();
  expect(invalid.state.error.value).toContain("页码无效");
  expect(await invalid.state.refresh()).toBe(false);
  expect(invalid.api.get).not.toHaveBeenCalled();
});
