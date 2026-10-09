import copy from "./catalog-common";

test("shared UI copy is a unique nonempty English/Chinese literal catalog", () => {
  const keys = copy.map(([key]) => key);
  expect(new Set(keys).size).toBe(keys.length);
  for (const pair of copy) expect(pair.every(value => typeof value === "string" && value.trim())).toBe(true);
});

test("drawing-view commands and recoverable error have both language labels", () => {
  const labels = new Map(copy);
  expect(labels.get("绘图视图工具")).toBe("Drawing view controls");
  expect(labels.get("缩小画板")).toBe("Zoom drawing out");
  expect(labels.get("放大画图")).toBe("Zoom drawing in");
  expect(labels.get("画板适应窗口")).toBe("Fit drawing to window");
  expect(labels.get("放大画板")).toBe("Expand drawing view");
  expect(labels.get("返回画板")).toBe("Return to drawing");
  expect(labels.get("重试视图操作")).toBe("Retry view operation");
  expect(labels.get("画板视图操作失败，请重试。")).toBe("The drawing view action failed. Retry.");
});
