import { useRoute, useRouter } from "vue-router";
import { createPinia, setActivePinia } from "pinia";
import { useWorkspaceStore } from "@/store/workspace";
import { captureWorkspaceIdentity, stopWorkspaceProbes } from "@/store/workspace-probes";
import { useAnalysisDelivery } from "./useAnalysisDelivery";
jest.mock("vue-router", () => ({ useRoute: jest.fn(), useRouter: jest.fn() }));
beforeEach(() => {
  jest.clearAllMocks(); window.history.replaceState({}, ""); localStorage.clear();
  setActivePinia(createPinia());
});
afterEach(() => { stopWorkspaceProbes(useWorkspaceStore()); localStorage.clear(); });
test("only a usable returned record identifier commits the current input before result navigation", async () => {
  const order = [], onCommitted = jest.fn(() => order.push("committed"));
  const push = jest.fn(() => { order.push("navigate"); return Promise.resolve(undefined); });
  useRoute.mockReturnValue({ fullPath: "/process?record=older#workspace-content" }); useRouter.mockReturnValue({ push });
  const deliver = useAnalysisDelivery("process", { onCommitted });
  await expect(deliver({ record_id: null })).rejects.toThrow("结果缺少"); expect(onCommitted).not.toHaveBeenCalled();
  await deliver({ record_id: "saved" });
  expect(order).toEqual(["committed", "navigate"]);
  expect(window.history.state.xSynthSubmittedInput).toEqual({ version: 1, kind: "process", id: "saved", location: "/process?record=older" });
});
test("failed result navigation keeps its actual saved pointer and cannot pretend no record exists", async () => {
  useRoute.mockReturnValue({ fullPath: "/process" }); useRouter.mockReturnValue({ push: jest.fn().mockResolvedValue({ failed: true }) });
  const committed = jest.fn();
  await expect(useAnalysisDelivery("process", { onCommitted: committed })({ record_id: "saved" })).rejects.toThrow("结果已保存");
  expect(committed).toHaveBeenCalledTimes(1); expect(window.history.state.xSynthSubmittedInput.id).toBe("saved");
});

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};

function deliveryFixture(onCommitted = jest.fn()) {
  const push = jest.fn().mockResolvedValue(undefined);
  useRoute.mockReturnValue({ fullPath: "/optimization" }); useRouter.mockReturnValue({ push });
  localStorage.setItem("accessToken", "fixture-delivery-owner-a");
  const workspace = useWorkspaceStore(), guard = captureWorkspaceIdentity(workspace);
  return { workspace, guard, push, onCommitted, deliver: useAnalysisDelivery("optimization", { onCommitted }) };
}

test.each(["identity", "replacement", "unavailable"])("caller guard blocks commit/history/navigation after %s retirement", async change => {
  const { workspace, guard, push, onCommitted, deliver } = deliveryFixture();
  let denied;
  try {
    if (change === "identity") localStorage.setItem("accessToken", "fixture-delivery-owner-b");
    else if (change === "replacement") { stopWorkspaceProbes(workspace); captureWorkspaceIdentity(workspace); }
    else denied = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Fixture storage denied"); });
    window.history.replaceState({ position: 12, retained: "Current owner" }, "");
    await expect(deliver({ record_id: "obsolete" }, guard)).resolves.toBeUndefined();
    expect(onCommitted).not.toHaveBeenCalled(); expect(push).not.toHaveBeenCalled();
    expect(window.history.state).toEqual({ position: 12, retained: "Current owner" });
  } finally { denied?.mockRestore(); }
});

test.each(["success", "reject"])("deferred onCommitted %s after A-to-B cannot alter current history or navigate", async outcome => {
  const held = deferred();
  const { guard, push, onCommitted, deliver } = deliveryFixture(jest.fn(() => held.promise));
  const pending = deliver({ record_id: "obsolete" }, guard);
  expect(onCommitted).toHaveBeenCalledTimes(1);
  localStorage.setItem("accessToken", "fixture-delivery-owner-b");
  const current = { position: 13, retained: "Owner B", xSynthSubmittedInput: { id: "current-b" } };
  window.history.replaceState(current, "");
  try {
    if (outcome === "success") held.resolve();
    else held.reject(new Error("Obsolete input commit failure"));
    await expect(pending).resolves.toBeUndefined();
    expect(push).not.toHaveBeenCalled();
    expect(window.history.state).toEqual(current);
  } finally { held.resolve(); await pending.catch(() => {}); }
});

test("caller guard preserves valid delivery and merges only its owned history pointer", async () => {
  const held = deferred();
  const { guard, push, onCommitted, deliver } = deliveryFixture(jest.fn(() => held.promise));
  window.history.replaceState({ position: 14, back: "/previous", retained: "Router-owned" }, "");
  const pending = deliver({ record_id: "saved" }, guard);
  expect(onCommitted).toHaveBeenCalledTimes(1); expect(push).not.toHaveBeenCalled();
  held.resolve(); await pending;
  expect(push).toHaveBeenCalledWith({ path: "/analyses/saved", query: { kind: "optimization" } });
  expect(window.history.state).toEqual({ position: 14, back: "/previous", retained: "Router-owned",
    xSynthSubmittedInput: { version: 1, kind: "optimization", id: "saved", location: "/optimization" } });
});

test("caller guard does not weaken record path validation", async () => {
  const { guard, push, onCommitted, deliver } = deliveryFixture();
  localStorage.setItem("accessToken", "fixture-delivery-owner-b");
  await expect(deliver({ record_id: null }, guard)).rejects.toThrow("结果缺少");
  expect(onCommitted).not.toHaveBeenCalled(); expect(push).not.toHaveBeenCalled();
});

test("caller guard suppresses an obsolete error from already-started navigation without rewriting current history", async () => {
  const held = deferred();
  const { guard, push, deliver } = deliveryFixture();
  push.mockReturnValueOnce(held.promise);
  const pending = deliver({ record_id: "saved" }, guard);
  await Promise.resolve();
  expect(push).toHaveBeenCalledTimes(1);
  localStorage.setItem("accessToken", "fixture-delivery-owner-b");
  window.history.replaceState({ position: 15, retained: "Current navigation" }, "");
  try {
    held.reject(new Error("Obsolete router rejection"));
    await expect(pending).resolves.toBeUndefined();
    expect(window.history.state).toEqual({ position: 15, retained: "Current navigation" });
  } finally { held.resolve(); await pending.catch(() => {}); }
});

test.each([
  ["assessment", "/assessment"], ["process", "/process"],
  ["conditions", "/forward?tab=context"], ["forward", "/forward?tab=forward"],
  ["impurity", "/impurity"], ["optimization", "/optimization"],
])("legacy single-result %s consumer needs no new identity reader", async (kind, entry) => {
  const push = jest.fn().mockResolvedValue(undefined), onCommitted = jest.fn();
  useRoute.mockReturnValue({ fullPath: entry + "#workspace-content" }); useRouter.mockReturnValue({ push });
  window.history.replaceState({ position: 17, retained: "Router state" }, "");
  const denied = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("No new identity access"); });
  try {
    await useAnalysisDelivery(kind, { onCommitted })({ record_id: "saved" });
    expect(denied).not.toHaveBeenCalled();
    expect(onCommitted).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith({ path: "/analyses/saved", query: { kind } });
    expect(window.history.state).toEqual({ position: 17, retained: "Router state",
      xSynthSubmittedInput: { version: 1, kind, id: "saved", location: entry } });
  } finally { denied.mockRestore(); }
});
