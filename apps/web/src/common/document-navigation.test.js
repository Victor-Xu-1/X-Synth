import {
  createDocumentNavigation,
  documentOrigin,
  documentPersistenceLabel,
  documentStateLabel,
} from "./document-navigation";
import { setLocale } from "@/i18n";

const id = "b".repeat(32);
function setup() {
  const draft = { dirty: true, version: "original" };
  const confirm = jest.fn().mockReturnValue(true);
  const navigation = createDocumentNavigation({
    isDirty: () => draft.dirty,
    snapshot: () => draft.version,
    confirm,
  });
  return { draft, confirm, navigation };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test("unsaved-route confirmations use the current language without changing the draft or starting an import", async () => {
  const { draft, confirm, navigation } = setup();
  const importRoute = jest.fn(), navigate = jest.fn();
  confirm.mockReturnValue(false);
  setLocale("en", { persist: false });
  expect(navigation.guard({ path: "/results" })).toBe(false);
  expect(confirm).toHaveBeenLastCalledWith("There are unsaved changes. Leave anyway?");
  await navigation.importFile({}, importRoute, navigate);
  expect(confirm).toHaveBeenLastCalledWith("There are unsaved changes. Open this file and replace the current route?");
  setLocale("zh-CN", { persist: false });
  expect(navigation.guard({ path: "/results" })).toBe(false);
  expect(confirm).toHaveBeenLastCalledWith("存在未保存修改，仍要离开？");
  expect(importRoute).not.toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalled();
  expect(draft).toEqual({ dirty: true, version: "original" });
});

test("the original-task caption is localized while navigation identifiers stay unchanged", () => {
  const source = { job_id: id, route_id: "askcos_mcts:record", route_index: 0 };
  setLocale("zh-CN", { persist: false });
  const before = documentOrigin({ source });
  setLocale("en", { persist: false });
  const after = documentOrigin({ source });
  expect(after.label).toBe("Original task · R1");
  expect(after.to).toEqual(before.to);
  expect(documentOrigin({ source: { job_id: id } }).label).toBe("Original task");
  expect(source).toEqual({ job_id: id, route_id: "askcos_mcts:record", route_index: 0 });
});
test("declining an unsaved replacement happens before import or POST and preserves the draft", async () => {
  const { draft, confirm, navigation } = setup();
  confirm.mockReturnValue(false);
  const post = jest.fn(),
    navigate = jest.fn();
  expect(await navigation.importFile({}, post, navigate)).toBe(false);
  expect(post).not.toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalled();
  expect(draft).toEqual({ dirty: true, version: "original" });
});
test("accepted import authorizes only its exact destination without clearing dirty data", async () => {
  const { draft, confirm, navigation } = setup(),
    events = [];
  confirm.mockImplementation(() => {
    events.push("confirm");
    return true;
  });
  const post = jest.fn(async () => {
    events.push("post");
    return { id };
  });
  const navigate = jest.fn(async (path) => {
    events.push("navigate");
    expect(draft.dirty).toBe(true);
    expect(navigation.guard({ path })).toBe(true);
  });
  expect(await navigation.importFile({}, post, navigate)).toBe(true);
  expect(events).toEqual(["confirm", "post", "navigate"]);
  confirm.mockReturnValue(false);
  expect(navigation.guard({ path: "/results" })).toBe(false);
  expect(draft.dirty).toBe(true);
});
test("failed import and rejected navigation preserve the unsaved draft", async () => {
  const { draft, navigation } = setup(),
    navigate = jest.fn();
  await expect(
    navigation.importFile(
      {},
      async () => {
        throw new Error("invalid file");
      },
      navigate,
    ),
  ).rejects.toThrow("invalid file");
  expect(navigate).not.toHaveBeenCalled();
  expect(
    await navigation.importFile(
      {},
      async () => ({ id }),
      async () => ({ aborted: true }),
    ),
  ).toBe(false);
  expect(draft).toEqual({ dirty: true, version: "original" });
});
test("new unsaved edits during import need their own confirmation", async () => {
  const { draft, confirm, navigation } = setup(),
    request = deferred(),
    navigate = jest.fn();
  confirm.mockReturnValueOnce(true).mockReturnValueOnce(false);
  const pending = navigation.importFile({}, () => request.promise, navigate);
  draft.version = "new edits";
  request.resolve({ id });
  expect(await pending).toBe(false);
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(navigate).not.toHaveBeenCalled();
  expect(draft).toEqual({ dirty: true, version: "new edits" });
});
test("authorization does not apply to a different destination or a modified draft", async () => {
  const { draft, confirm, navigation } = setup();
  confirm.mockReturnValueOnce(true).mockReturnValue(false);
  await navigation.importFile(
    {},
    async () => ({ id }),
    async (path) => {
      expect(navigation.guard({ path: "/editor/" + "c".repeat(32) })).toBe(
        false,
      );
      draft.version = "new edits";
      expect(navigation.guard({ path })).toBe(false);
      return { aborted: true };
    },
  );
});
test.each(["invalidate", "dispose"])(
  "a late imported document cannot navigate after %s",
  async (action) => {
    const { navigation } = setup(),
      request = deferred(),
      navigate = jest.fn();
    const pending = navigation.importFile({}, () => request.promise, navigate);
    navigation[action]();
    request.resolve({ id });
    expect(await pending).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  },
);
test("stale failures do not overwrite a later document's error state", async () => {
  const { navigation } = setup(),
    request = deferred();
  const pending = navigation.importFile({}, () => request.promise, jest.fn());
  navigation.invalidate();
  request.reject(new Error("late failure"));
  expect(await pending).toBe(false);
});
test("repeated import clicks do not create another document while one is pending", async () => {
  const { navigation } = setup(),
    request = deferred(),
    post = jest.fn(() => request.promise);
  const first = navigation.importFile({}, post, jest.fn());
  expect(await navigation.importFile({}, post, jest.fn())).toBe(false);
  expect(post).toHaveBeenCalledTimes(1);
  request.resolve({ id });
  await first;
});
test.each([null, { id: "/unsafe" }, { id: [id] }])(
  "invalid document identifiers cannot navigate",
  async (saved) => {
    const { navigation } = setup(),
      navigate = jest.fn();
    await expect(
      navigation.importFile({}, async () => saved, navigate),
    ).rejects.toThrow("标识");
    expect(navigate).not.toHaveBeenCalled();
  },
);

const graph = {
  target_id: "target",
  nodes: [
    { id: "target", type: "molecule", smiles: "CCO", position: { x: 5, y: 5 } },
  ],
  edges: [],
};
const copy = { state: "source_copy", graph };
test("persistence and scientific source state remain independent", () => {
  expect(documentPersistenceLabel(copy, { dirty: false })).toBe("已保存");
  expect(documentStateLabel(copy, graph)).toBe("计算结果副本");
  expect(documentPersistenceLabel({ state: "draft" }, { dirty: false })).toBe(
    "已保存",
  );
  expect(documentStateLabel({ state: "draft", graph }, graph)).toBe("草稿");
  expect(documentPersistenceLabel(copy, { dirty: true })).toBe("未保存");
});
test("annotations and layout do not change source state, but chemistry does", () => {
  const annotated = {
    ...graph,
    nodes: graph.nodes.map((node) => ({
      ...node,
      note: "annotation",
      label: "target",
      position: { x: 10, y: 10 },
    })),
  };
  expect(documentStateLabel(copy, annotated)).toBe("计算结果副本");
  const edited = { ...graph, nodes: [{ ...graph.nodes[0], smiles: "O" }] };
  expect(documentStateLabel(copy, edited)).toBe("草稿");
  expect(documentStateLabel({ state: "draft", graph }, graph)).toBe("草稿");
  expect(documentStateLabel({ graph }, graph)).toBe("来源状态未记录");
});
test("origin links expose only bounded server-reported task and route identifiers", () => {
  const source = { job_id: id, route_id: "askcos_mcts:record", route_index: 0 };
  expect(documentOrigin({ source })).toEqual({
    to: {
      path: "/results/" + id,
      query: { route_id: source.route_id, route_index: "0" },
    },
    label: "原始任务 · R1",
  });
  expect(
    documentOrigin({ source: { ...source, route_index: 10 } }).to.query,
  ).not.toHaveProperty("route_index");
  expect(
    documentOrigin({ source: { ...source, job_id: "/unsafe" } }),
  ).toBeNull();
  expect(documentOrigin({ source: { ...source, job_id: [id] } })).toBeNull();
  expect(documentOrigin({ state: "draft" })).toBeNull();
});
