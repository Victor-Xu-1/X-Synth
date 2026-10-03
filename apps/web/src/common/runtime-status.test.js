import {
  environmentStatus,
  loadRuntimeStatus,
  memoryText,
  runtimeRows,
  strategyText,
} from "./runtime-status";

// Environment API contract records, not chemistry-provider replacements.
const environment = {
  schema_version: 1,
  platform: { name: "X-Synth", version: "0.1.0" },
  engines: [{ id: "askcos_v2" }],
  health: { service: "x-synth", stock_snapshot: { unique_structures: 42 } },
  runtime: { budget: { active_jobs: 1 } },
};

test("process existence is not model readiness and unknown memory is not zero", () => {
  const rows = runtimeRows(
    { service_checks: { mcts: false } },
    {
      resources: {
        services: { mcts: { status: "running", rss_bytes: 1024 ** 2 } },
      },
    },
  );
  expect(rows.find((row) => row.id === "mcts").ready).toBe(false);
  expect(memoryText(rows.find((row) => row.id === "mcts").rss)).toBe("1.0 MiB");
  expect(memoryText(rows.find((row) => row.id === "fast_filter").rss)).toBe(
    "—",
  );
});

test("independent template errors retain successful environment data", async () => {
  const api = {
    get: async (url) => {
      if (url.includes("template-library")) throw new Error("unavailable");
      return environment;
    },
  };
  const snapshot = await loadRuntimeStatus(api);
  expect(snapshot.health.service).toBe("x-synth");
  expect(snapshot.unavailable).toEqual(["templates"]);
});

test("monitoring reuses one environment projection and one template request", async () => {
  const calls = [];
  const snapshot = await loadRuntimeStatus({
    get: async (url, params, query) => {
      calls.push([url, params, query]);
      return url.endsWith("/environments")
        ? environment
        : { template_count: 12 };
    },
  });
  expect(calls).toEqual([
    ["/api/v1/environments", null, false],
    ["/api/v1/template-library/health", null, false],
  ]);
  expect(snapshot.environments).toBe(environment);
  expect(snapshot.health).toBe(environment.health);
  expect(snapshot.runtime).toBe(environment.runtime);
  expect(snapshot.stock.snapshot).toBe(environment.health.stock_snapshot);
  expect(snapshot.unavailable).toEqual([]);
});

test.each([
  null,
  {},
  { ...environment, schema_version: 2 },
  { ...environment, engines: {} },
  { ...environment, health: null },
  { ...environment, runtime: null },
])(
  "invalid environment responses stay unavailable, not ready",
  async (response) => {
    const snapshot = await loadRuntimeStatus({
      get: async (url) =>
        url.endsWith("/environments") ? response : { template_count: 12 },
    });
    expect(snapshot.environments).toBeUndefined();
    expect(snapshot.health).toBeUndefined();
    expect(snapshot.templates.template_count).toBe(12);
    expect(snapshot.unavailable).toEqual(["environments"]);
  },
);

test("environment request rejection is reported only once", async () => {
  const snapshot = await loadRuntimeStatus({
    get: async () => {
      throw new Error("offline");
    },
  });
  expect(snapshot.unavailable).toEqual(["environments", "templates"]);
});

test("environment state and strategies use neutral labels without invented readiness", () => {
  expect(environmentStatus("ready")).toBe("已就绪");
  expect(environmentStatus("degraded")).toBe("部分未就绪");
  expect(environmentStatus("unavailable")).toBe("不可用");
  expect(environmentStatus(null)).toBe("未读取");
  expect(strategyText(["mcts", "retro_star"])).toBe(
    "树搜索 · MCTS / 启发式搜索 · RetroStar",
  );
  expect(strategyText([])).toBe("暂无可用策略");
});
