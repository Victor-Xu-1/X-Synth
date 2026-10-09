import { errorMessage } from "./workspace-errors";

test("a genuine request deadline is not misreported as invalid input or a failed RXN file", () => {
  expect(errorMessage(new DOMException("deadline", "TimeoutError"), "RXN 文件无法解析，未改变画板。"))
    .toBe("服务请求超时，请刷新或重试。");
});
test("structured server detail and cancellation keep their existing semantics", () => {
  expect(errorMessage(new Error(JSON.stringify({ detail: "original detail" })))).toBe("original detail");
  expect(errorMessage(new Error(JSON.stringify({ detail: [{ msg: "first" }, { msg: "second" }] })))).toBe("first；second");
  expect(errorMessage(new DOMException("cancel", "AbortError"))).toBe("请求已取消。");
  expect(errorMessage(new Error("network"), "fallback")).toBe("fallback");
});
