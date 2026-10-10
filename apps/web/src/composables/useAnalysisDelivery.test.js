import { useRoute, useRouter } from "vue-router";
import { useAnalysisDelivery } from "./useAnalysisDelivery";
jest.mock("vue-router", () => ({ useRoute: jest.fn(), useRouter: jest.fn() }));
beforeEach(() => { jest.clearAllMocks(); window.history.replaceState({}, ""); });
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
