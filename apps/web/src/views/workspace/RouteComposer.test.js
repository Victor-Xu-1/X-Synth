import { buildUnifiedRouteRequestBody } from "@/common/unified-route";
test("workspace settings map to the sole product contract without changing route quality defaults", () => {
  const body = buildUnifiedRouteRequestBody({
    smiles: "CCO",
    description: "测试",
    expansion_time: 120,
    max_routes: 6,
    tuning: { max_depth: 15, template_count: 1200 },
  });
  expect(body).toMatchObject({
    smiles: "CCO",
    description: "测试",
    backend: "askcos",
    strategies: ["mcts", "retro_star"],
    expansion_time: 120,
    min_routes: 3,
    max_routes: 6,
    public: false,
  });
  expect(body.tuning).toMatchObject({
    max_depth: 15,
    template_count: 1200,
    minimum_plausibility: 0.75,
    cumulative_probability: 0.999,
  });
});
