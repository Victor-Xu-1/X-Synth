import { loadTaskDetail } from "./task-detail-data";

test("artifact failure does not hide fresh lifecycle status or engine recovery reason", async () => {
  const response = {
    status: "waiting_for_engine",
    error_code: "engine_unavailable",
  };
  const result = await loadTaskDetail(
    {
      get: async (url) => {
        if (url.includes("retrieve"))
          throw new Error("route_artifact_unavailable");
        return response;
      },
    },
    "task-id",
  );
  expect(result.job).toBe(response);
  expect(result.candidates).toEqual([]);
  expect(result.error).toBeTruthy();
});

test("invalid route records stay errors while task status remains available", async () => {
  const result = await loadTaskDetail(
    {
      get: async (url) =>
        url.includes("retrieve")
          ? { result: { unified_route_pool: { selected_routes: [{}] } } }
          : { status: "completed" },
    },
    "task-id",
  );
  expect(result.job.status).toBe("completed");
  expect(result.candidates).toEqual([]);
  expect(result.error).toBe("路线记录无效。");
});
