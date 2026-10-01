const fs = require("fs");
const path = require("path");
const { API } = require("@/common/api");

const apiPath = path.resolve(__dirname, "api.js");

function readApi() {
  return fs.readFileSync(apiPath, "utf8");
}

test("api recovers stale guest sessions after backend restarts", () => {
  const text = readApi();

  expect(text).toContain("recoverGuestSession");
  expect(text).toContain("guestUsername");
  expect(text).toContain("guestPassword");
  expect(text).toContain('response.status === 401');
  expect(text).toContain('endpoint !== "/api/admin/token"');
  expect(text).toContain("return this.request(method, endpoint, data, query, false)");
  expect(text).toContain("redirectToLogin");
});

test("localizes generic celery task failures with caller fallback", () => {
  const errorObj = API.toErrorObject(
    new Error("Task failed!"),
    "可合成性评估失败，请检查分子输入、模型服务和后端任务状态。"
  );

  expect(errorObj).toStrictEqual({
    string_error: "可合成性评估失败，请检查分子输入、模型服务和后端任务状态。",
  });
});

test("preserves structured backend error details", () => {
  const errorObj = API.toErrorObject(
    new Error(JSON.stringify({ detail: "模型服务未响应" }))
  );

  expect(errorObj).toStrictEqual({
    detail: "模型服务未响应",
    string_error: "模型服务未响应",
  });
});
