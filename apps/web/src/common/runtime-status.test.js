import { loadRuntimeStatus, memoryText, runtimeRows } from "./runtime-status";

test("process existence is not model readiness and unknown memory is not zero", () => {
  const rows = runtimeRows({ service_checks: { mcts: false } }, { resources: { services: { mcts: { status: "running", rss_bytes: 1024 ** 2 } } } });
  expect(rows.find(row => row.id === "mcts").ready).toBe(false);
  expect(memoryText(rows.find(row => row.id === "mcts").rss)).toBe("1.0 MiB");
  expect(memoryText(rows.find(row => row.id === "fast_filter").rss)).toBe("—");
});

test("independent monitoring errors retain successful real response contracts", async () => {
  const api = { get: async url => {
    if (url.includes("template-library")) throw new Error("unavailable");
    return { service: "x-synth" };
  } };
  const snapshot = await loadRuntimeStatus(api);
  expect(snapshot.health.service).toBe("x-synth");
  expect(snapshot.unavailable).toEqual(["templates"]);
});
