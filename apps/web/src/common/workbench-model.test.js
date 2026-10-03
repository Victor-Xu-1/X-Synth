import {
  defaultSearchSettings,
  normalizeMode,
  querySeed,
  oneStepCandidate,
} from "./workbench-model";

test("one workbench uses explicit supported modes", () => {
  expect(normalizeMode("manual")).toBe("manual");
  expect(normalizeMode("import")).toBe("import");
  expect(normalizeMode("unsupported")).toBe("auto");
});
test("default route settings retain authoritative quality policy and convert seconds to minutes", () => {
  expect(defaultSearchSettings()).toEqual({
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
test("rerun restores only bounded supported search settings", () => {
  const seed = querySeed({
    smiles: "CCO",
    task_name: "任务",
    search_settings: JSON.stringify({
      backend: "other",
      public: true,
      expansion_time: 600,
      max_routes: 100,
      tuning: { max_depth: 900, minimum_plausibility: -0.5 },
    }),
  });
  expect(seed.smiles).toBe("CCO");
  expect(seed.settings).toMatchObject({
    minutes: 10,
    maxRoutes: 10,
    tuning: { max_depth: 50, minimum_plausibility: 0 },
  });
  expect(seed.settings.backend).toBeUndefined();
  expect(seed.settings.public).toBeUndefined();
});
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
