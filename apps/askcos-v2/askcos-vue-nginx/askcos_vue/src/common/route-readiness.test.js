const { normalizeRouteReadiness } = require("@/common/route-readiness");

test("service liveness is not model readiness", () => {
  expect(normalizeRouteReadiness({ status: "running", route_search_ready: false }).ready).toBe(false);
  expect(normalizeRouteReadiness({ status: "ready" }).ready).toBe(false);
  expect(normalizeRouteReadiness({ route_search_ready: "true" }).ready).toBe(false);
  expect(normalizeRouteReadiness(null).ready).toBe(false);
});

test("a verified backend readiness response enables route submission", () => {
  expect(normalizeRouteReadiness({ route_search_ready: true })).toStrictEqual({
    ready: true, label: "后端就绪", message: "",
  });
});
