import {
  defaultSearchSettings,
  normalizeMode,
  querySeed,
  oneStepCandidate,
  buildWorkbenchRequest,
  searchSettings,
} from "./workbench-model";
import { buildTaskSearchLocation } from "./task-history-view";

test("one-step previews retain provided native evidence without adding a closure claim", () => {
  const item = {
    outcome: "CCO.N",
    plausibility: 0.8,
    model_metadata: [
      {
        model_name: "pistachio",
        source: { template: { _id: "native-record", index: 17 } },
      },
    ],
  };
  const candidate = oneStepCandidate(
    { canonical: "CCN", model: "pistachio", outcomes: [item] },
    0,
  );
  expect(candidate.steps[0].metadata).toBe(item);
  expect(candidate.closed).toBe(false);
  expect(candidate.closure_sources).toBeUndefined();
  expect(
    candidate.steps[0].metadata.model_metadata[0].source.template.index,
  ).toBe(17);
});

test("one workbench uses explicit supported modes", () => {
  expect(normalizeMode("manual")).toBe("manual");
  expect(normalizeMode("import")).toBe("import");
  expect(normalizeMode("unsupported")).toBe("auto");
});
test("default route settings retain authoritative quality policy and convert seconds to minutes", () => {
  expect(defaultSearchSettings()).toEqual({
    strategies: ["mcts", "retro_star"],
    maxPaths: 200,
    minRoutes: 3,
    repairAttempts: 1,
    maxRoutes: 10,
    minutes: 30,
    tuning: {
      max_depth: 12,
      max_branching: 50,
      template_count: 1000,
      cumulative_probability: 0.999,
      minimum_plausibility: 0.75,
    },
  });
});
test("rerun restores only supported private search settings", () => {
  const seed = querySeed({
    smiles: "CCO",
    task_name: "任务",
    search_settings: JSON.stringify({
      backend: "other",
      public: true,
      expansion_time: 600,
      max_routes: 10,
      tuning: { max_depth: 15, minimum_plausibility: 0 },
    }),
  });
  expect(seed.smiles).toBe("CCO");
  expect(seed.settings).toMatchObject({
    minutes: 10,
    maxRoutes: 10,
    tuning: { max_depth: 15, minimum_plausibility: 0 },
  });
  expect(seed.settings.backend).toBeUndefined();
  expect(seed.settings.public).toBeUndefined();
});
test.each([60, 61, 127, 7199, 7200])(
  "history prefill and draft submission faithfully replay %i seconds",
  (budget) => {
    const settings = {
      smiles: "CCO",
      description: "Contract replay",
      backend: "askcos",
      public: false,
      strategies: ["retro_star"],
      max_paths: 80,
      min_routes: 4,
      max_routes: 8,
      expansion_time: budget,
      repair_attempts: 0,
      tuning: {
        max_depth: 15,
        max_branching: 40,
        template_count: 800,
        cumulative_probability: 0.001,
        minimum_plausibility: 0,
      },
    };
    const location = buildTaskSearchLocation({ settings });
    const seed = querySeed(location.query);
    const body = buildWorkbenchRequest({
      smiles: seed.smiles,
      name: seed.name,
      settings: seed.settings,
    });
    expect(body).toEqual(settings);
  },
);
test("a structure-only handoff restores fresh policy instead of retaining hidden replay settings", () => {
  const seed = querySeed({ smiles: "O" });
  expect(seed.settings).toEqual(defaultSearchSettings());
  const first = defaultSearchSettings();
  first.strategies.pop();
  first.tuning.max_depth = 50;
  expect(defaultSearchSettings().strategies).toHaveLength(2);
  expect(defaultSearchSettings().tuning.max_depth).toBe(12);
});
test("probability input attributes admit the same fractional values as the backend", () => {
  for (const key of ["cumulative_probability", "minimum_plausibility"]) {
    const field = searchSettings.find((item) => item.key === key);
    expect(field.step).toBe("any");
  }
  const settings = defaultSearchSettings();
  settings.tuning.cumulative_probability = 0.000123;
  settings.tuning.minimum_plausibility = 0.755;
  expect(
    buildWorkbenchRequest({ smiles: "CCO", name: "", settings }).tuning,
  ).toMatchObject({
    cumulative_probability: 0.000123,
    minimum_plausibility: 0.755,
  });
});
test.each([
  { strategies: ["unknown"] },
  { max_paths: 600 },
  { repair_attempts: 2 },
  { min_routes: 4, max_routes: 3 },
  { expansion_time: "120" },
  { tuning: { cumulative_probability: 0 } },
])(
  "invalid replay is rejected before becoming a composer draft",
  (settings) => {
    expect(() =>
      querySeed({ search_settings: JSON.stringify(settings) }),
    ).toThrow();
  },
);
test.each([null, true, "30", NaN, Infinity])(
  "invalid draft budget cannot be submitted: %p",
  (minutes) => {
    expect(() =>
      buildWorkbenchRequest({
        smiles: "CCO",
        name: "",
        settings: { ...defaultSearchSettings(), minutes },
      }),
    ).toThrow();
  },
);
test("mode switches do not alter the seed identity or erase edited drafts", () => {
  expect(querySeed({ mode: "manual" })).toBeNull();
  expect(querySeed({ smiles: "CCO", mode: "manual" }).key).toBe(
    querySeed({ smiles: "CCO", mode: "auto" }).key,
  );
  expect(() => querySeed({ search_settings: "not-json" })).toThrow();
  expect(() => querySeed({ search_settings: "[]" })).toThrow();
  for (const value of ["null", "0", "false"])
    expect(() => querySeed({ search_settings: value })).toThrow();
  expect(() => querySeed({ search_settings: "x".repeat(16001) })).toThrow();
});
test("one step candidate stays an unclosed draft and uses the result snapshot", () => {
  const result = {
    canonical: "CCO",
    model: "pistachio",
    outcomes: [{ outcome: "CCBr.O", plausibility: 0.8 }],
  };
  expect(oneStepCandidate(result, 0)).toMatchObject({
    target_smiles: "CCO",
    closed: false,
    steps: [{ product: "CCO", precursors: ["CCBr", "O"], confidence: 0.8 }],
  });
  expect(() => oneStepCandidate(result, 1)).toThrow();
});
