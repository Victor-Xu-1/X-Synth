/** @jest-environment node */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  compileScript,
  compileStyle,
  compileTemplate,
  parse,
} from "@vue/compiler-sfc";
import { graphFromCandidate } from "./route-graph";
import {
  candidateChoices,
  closureLabel,
  confidenceText,
  engineLabel,
  forwardEvidence,
  longestLinearSteps,
  modelEvidence,
  nodeChoices,
  originalRouteIndex,
  readSelectedRoutes,
  retainedRouteId,
  requestedRouteId,
  stepDetails,
  taskIdentifier,
} from "./route-details";
// Public RouteCandidate contract data, never a chemistry-provider replacement.
const candidate = {
  route_id: "askcos_retro_star:contract",
  engine: "askcos_retro_star",
  target_smiles: "CC(=O)NCCc1ccc(F)cc1",
  closed: true,
  starting_materials: ["CC(=O)ON1C(=O)CCC1=O", "NCCc1ccc(F)cc1"],
  steps: [
    {
      step_id: "s1",
      product: "CC(=O)NCCc1ccc(F)cc1",
      precursors: ["CC(=O)ON1C(=O)CCC1=O", "NCCc1ccc(F)cc1"],
      reaction_smiles:
        "CC(=O)ON1C(=O)CCC1=O.NCCc1ccc(F)cc1>>CC(=O)NCCc1ccc(F)cc1",
      confidence: 0.999445915222168,
      source: "askcos:template_relevance:pistachio",
      metadata: {
        model_metadata: [
          {
            backend: "template_relevance",
            model_name: "pistachio",
            rank: 59,
            source: { template: { index: 31232, template_set: "pistachio" } },
          },
        ],
      },
    },
  ],
  closure_sources: ["askcos_buyables", "mcule:MCULE-2600853014"],
  evidence_refs: ["reaction:bce0dea41f2f763d"],
  metadata: {
    forward_validation_passed: true,
    forward_validation_method: "native_template_reconstruction",
    full_forward_prediction_validated: false,
    forward_validation_steps: [true],
  },
};
const branch = {
  ...candidate,
  route_id: "branch",
  engine: "askcos_mcts",
  closed: false,
  steps: [
    ...candidate.steps,
    {
      step_id: "s2",
      product: candidate.steps[0].precursors[1],
      precursors: ["NCCc1ccccc1", "F"],
      confidence: 0,
    },
  ],
  route_score: 0,
};
const graph = graphFromCandidate(branch);
const source = (file) => readFileSync(resolve(__dirname, "..", file), "utf8");
const compactSource = (file) => source(file).replace(/\s+/g, " ");
test("filter and sort preserve original indices and never mutate selected records", () => {
  const routes = [
    candidate,
    branch,
    { ...candidate, route_id: "unknown", route_score: null },
  ];
  const snapshot = JSON.stringify(routes);
  expect(
    candidateChoices(routes, { engine: "askcos_mcts" })[0].originalIndex,
  ).toBe(1);
  expect(candidateChoices(routes, { closure: "closed" })).toHaveLength(2);
  expect(candidateChoices(routes, { closure: "open" })[0].route.route_id).toBe(
    "branch",
  );
  expect(candidateChoices(routes, { query: "mcule" })).toHaveLength(3);
  expect(
    candidateChoices(routes, { query: "NCCc1ccccc1" })[0].originalIndex,
  ).toBe(1);
  expect(candidateChoices(routes, { query: "r2" })[0].originalIndex).toBe(1);
  expect(
    candidateChoices(routes, { sort: "steps" }).map(
      (item) => item.originalIndex,
    ),
  ).toEqual([0, 2, 1]);
  expect(candidateChoices(routes, { sort: "score" })[0].originalIndex).toBe(1);
  expect(candidateChoices(routes, { query: "absent" })).toEqual([]);
  expect(JSON.stringify(routes)).toBe(snapshot);
});
test("all viewing modes resolve an edit by stable route identity into current original order", () => {
  const routes = [candidate, branch];
  const visible = candidateChoices(routes, {
    engine: "askcos_mcts",
    sort: "score",
  });
  expect(visible[0].originalIndex).toBe(1);
  expect(originalRouteIndex(routes, visible[0].route.route_id)).toBe(1);
  expect(originalRouteIndex([branch, candidate], branch.route_id)).toBe(0);
  expect(originalRouteIndex(routes, "missing")).toBe(-1);
});
test("route links resolve stable identity before a possibly stale original index", () => {
  const routes = [candidate, branch];
  expect(
    requestedRouteId(routes, { route_id: branch.route_id, route_index: "0" }),
  ).toBe(branch.route_id);
  expect(requestedRouteId(routes, { route_index: "1" })).toBe(branch.route_id);
  expect(
    requestedRouteId([branch, candidate], {
      route_id: branch.route_id,
      route_index: "1",
    }),
  ).toBe(branch.route_id);
  expect(requestedRouteId([], { route_id: branch.route_id })).toBe("");
});
test("ambiguous, absent and invalid route links cannot silently select a different route", () => {
  const routes = [candidate, branch];
  for (const query of [
    {},
    { route_id: "missing", route_index: "1" },
    { route_id: [branch.route_id], route_index: "1" },
    { route_index: ["1"] },
    { route_index: "-1" },
    { route_index: "1.0" },
    { route_index: "1e0" },
    { route_index: "999999999999999999999" },
    { route_index: "2" },
  ]) expect(requestedRouteId(routes, query)).toBe("");
});
test("poll completion and UI sorting retain selection without resetting existing filters", () => {
  const filters = {
    query: "branch",
    engine: "askcos_mcts",
    closure: "open",
    sort: "steps",
  };
  const snapshot = JSON.stringify(filters);
  expect(
    retainedRouteId(
      candidateChoices([candidate, branch], filters),
      branch.route_id,
    ),
  ).toBe(branch.route_id);
  expect(
    retainedRouteId(
      candidateChoices([branch, candidate], filters),
      branch.route_id,
    ),
  ).toBe(branch.route_id);
  expect(JSON.stringify(filters)).toBe(snapshot);
  expect(retainedRouteId(candidateChoices([candidate]), "missing")).toBe(
    candidate.route_id,
  );
  expect(retainedRouteId([], branch.route_id)).toBe("");
});
test("unknown scores sort last while actual zero and negative scores remain valid records", () => {
  const routes = [
    candidate,
    branch,
    { ...candidate, route_id: "negative", route_score: -1 },
    { ...candidate, route_id: "high", route_score: 9 },
  ];
  expect(
    candidateChoices(routes, { sort: "score" }).map(
      (item) => item.originalIndex,
    ),
  ).toEqual([3, 1, 2, 0]);
});
test("selected-only reading does not use rejected or raw candidates", () => {
  const response = {
    result: {
      unified_route_pool: {
        selected_routes: [candidate],
        rejected_routes: [branch],
      },
    },
  };
  expect(readSelectedRoutes(response)).toEqual([candidate]);
  expect(readSelectedRoutes({ result: null })).toEqual([]);
  expect(
    readSelectedRoutes({
      result: { unified_route_pool: { rejected_routes: [branch] } },
    }),
  ).toEqual([]);
});
test("invalid result records are rejected instead of becoming partial source graphs", () => {
  const result = (selected_routes) => ({
    result: { unified_route_pool: { selected_routes } },
  });
  expect(() => readSelectedRoutes(result({}))).toThrow();
  for (const value of [
    { ...candidate, steps: null },
    { ...candidate, target_smiles: "" },
    { ...candidate, steps: [{ product: "", precursors: [] }] },
    { ...candidate, steps: [{ product: "CCO", precursors: [null] }] },
  ])
    expect(() => readSelectedRoutes(result([value]))).toThrow("记录格式无效");
});
test("synthetic ordering retains original reaction anchors and evidence indices", () => {
  const steps = stepDetails(branch, graph);
  expect(graph.target_id).toBe("m-1");
  expect(steps.map((step) => step.nodeId)).toEqual(["r-2", "r-1"]);
  expect(steps.map((step) => step.sourceIndex)).toEqual([1, 0]);
  expect(steps.map((step) => step.number)).toEqual([1, 2]);
  expect(steps[1].product.nodeId).toBe("m-1");
  expect(steps[1].precursors.map((value) => value.nodeId)).toEqual([
    "m-2",
    "m-3",
  ]);
  expect(steps[0].product.nodeId).toBe("m-3");
  expect(steps[0].precursors.map((value) => value.nodeId)).toEqual([
    "m-4",
    "m-5",
  ]);
  expect(
    stepDetails(branch, { ...graph, nodes: [...graph.nodes].reverse() }),
  ).toEqual(steps);
  expect(stepDetails(branch, { nodes: [], edges: [] })[0].nodeId).toBeNull();
});
test("node options contain all branches and distinguish starting material from a commercial claim", () => {
  const choices = nodeChoices(graph);
  expect(choices[0]).toMatchObject({ value: "m-1", label: "目标分子 · m-1" });
  expect(choices).toHaveLength(graph.nodes.length);
  expect(choices.find((item) => item.value === "m-3").label).toBe(
    "中间体 · m-3",
  );
  expect(choices.find((item) => item.value === "m-4").label).toBe(
    "起始原料 · m-4",
  );
  expect(choices.some((item) => /商购|可购买/.test(item.label))).toBe(false);
});
test("confidence is displayed as its own field and unknown closure stays unknown", () => {
  expect(confidenceText(0)).toBe("0.000");
  expect(confidenceText(candidate.steps[0].confidence)).toBe("0.999");
  expect(confidenceText(0.87)).toBe("0.870");
  for (const value of [null, undefined, false, "0.8", Infinity, NaN, -1, 1.2])
    expect(confidenceText(value)).toBe("未记录");
  expect(closureLabel({ closed: true })).toBe("库存闭合");
  expect(closureLabel({ closed: "true" })).toBe("闭合未记录");
  expect(
    closureLabel({ closed: false, metadata: { historical_unreviewed: true } }),
  ).toBe("历史未复核");
  expect(engineLabel(candidate.engine)).toBe("启发式搜索 · RetroStar");
  expect(engineLabel("unrecognized")).toBe("unrecognized");
  expect(stepDetails(branch, graph)[0].confidence).toBe("0.000");
});

test("neutral engine labels preserve raw backend and template provenance", () => {
  const before = JSON.stringify(candidate);
  expect(engineLabel("askcos_mcts")).toBe("树搜索 · MCTS");
  expect(engineLabel("ASKCOS / pistachio")).toBe("单步分析 · pistachio");
  expect(engineLabel(candidate.engine)).not.toContain("ASKCOS");
  expect(JSON.stringify(candidate)).toBe(before);
  expect(candidate.steps[0].source).toBe("askcos:template_relevance:pistachio");
});
test("longest linear length traverses all branches and ignores provider depth or score", () => {
  const branched = {
    ...branch,
    steps: [
      ...branch.steps,
      {
        product: candidate.steps[0].precursors[0],
        precursors: ["CC(=O)O", "ON1C(=O)CCC1=O"],
      },
    ],
    metadata: { pathway_properties: { depth: 99 } },
  };
  expect(branched.steps).toHaveLength(3);
  expect(longestLinearSteps(branched)).toBe(2);
  expect(longestLinearSteps(candidate)).toBe(1);
  expect(longestLinearSteps({ target_smiles: "CCO", steps: [] })).toBe(0);
});
test("template reconstruction does not imply independent forward prediction", () => {
  expect(forwardEvidence(candidate)).toEqual(
    expect.arrayContaining([
      { label: "验证方法", value: "模板重构一致性" },
      { label: "模板重构", value: "通过" },
      { label: "独立正向预测", value: "未验证" },
    ]),
  );
  expect(forwardEvidence({ metadata: {} })).toEqual([]);
  expect(
    forwardEvidence({ metadata: { forward_validation_passed: true } }),
  ).not.toEqual(
    expect.arrayContaining([{ label: "独立正向预测", value: "已验证" }]),
  );
});
test("step-level reconstruction flags retain their source indices after synthetic ordering", () => {
  const checked = {
    ...branch,
    metadata: {
      forward_validation_method: "native_template_reconstruction",
      forward_validation_steps: [true, false],
    },
  };
  expect(stepDetails(checked, graph).map((step) => step.validation)).toEqual([
    "模板重构 未通过",
    "模板重构 通过",
  ]);
  expect(
    stepDetails({ ...branch, metadata: {} }, graph).map(
      (step) => step.validation,
    ),
  ).toEqual(["", ""]);
});
test("model fields appear only when explicitly sourced, preserving actual zero values", () => {
  expect(modelEvidence(candidate.steps[0])[0]).toEqual(
    expect.arrayContaining([
      { label: "模型", value: "pistachio" },
      { label: "模板序号", value: 31232 },
    ]),
  );
  expect(modelEvidence({ metadata: { model_metadata: [null, {}] } })).toEqual(
    [],
  );
  expect(
    modelEvidence({
      metadata: { model_metadata: [{ rank: 0, model_score: 0 }] },
    })[0],
  ).toEqual([
    { label: "模型排名", value: 0 },
    { label: "模型分数", value: 0 },
  ]);
});
test("URL task ids are validated without interpolating path or query fragments", () => {
  expect(taskIdentifier("110515bcaa4c437b9a51930225649249")).toBe(
    "110515bcaa4c437b9a51930225649249",
  );
  for (const value of [
    null,
    ["one"],
    "",
    "../other",
    "a?b=1",
    "a/b",
    "%2fother",
    "a".repeat(129),
  ])
    expect(taskIdentifier(value)).toBe("");
});
test("step scores use a neutral Chinese label without asserting FF provenance", () => {
  const { descriptor } = parse(source("components/routes/RouteStepList.vue"));
  const pending = [descriptor.template.ast];
  let score;
  while (pending.length) {
    const node = pending.pop();
    if (
      node.type === 1 &&
      node.tag === "span" &&
      node.props.some(
        (prop) =>
          prop.type === 6 &&
          prop.name === "class" &&
          prop.value?.content === "step-confidence",
      )
    ) {
      score = node;
      break;
    }
    pending.push(...(node.children || []));
  }
  expect(score).toBeDefined();
  expect(
    score.children
      .filter((node) => node.type === 2)
      .map((node) => node.content)
      .join("")
      .trim(),
  ).toBe("步骤分数");
  expect(score.children.find((node) => node.type === 5).content.content).toBe(
    "step.confidence",
  );
});
test.each([
  "views/workspace/TaskDetail.vue",
  "components/routes/RouteStepList.vue",
  "components/routes/RouteEvidencePanel.vue",
  "components/routes/RouteReader.vue",
  "components/routes/RouteFilters.vue",
  "components/routes/RouteMaterials.vue",
  "components/routes/RouteConditions.vue",
  "components/routes/RoutePreview.vue",
])("%s compiles with the real Vue compiler", (filename) => {
  const { descriptor, errors } = parse(source(filename), { filename });
  expect(errors).toEqual([]);
  const script = compileScript(descriptor, { id: "route-contract" });
  expect(
    compileTemplate({
      filename,
      id: "route-contract",
      source: descriptor.template.content,
      compilerOptions: { bindingMetadata: script.bindings },
    }).errors,
  ).toEqual([]);
  for (const style of descriptor.styles)
    expect(
      compileStyle({
        filename,
        id: "data-v-route-contract",
        source: style.content,
        scoped: style.scoped,
      }).errors,
    ).toEqual([]);
});
test("viewer stays read-only and both single and overview edit actions share original-index from-task", () => {
  const detail = compactSource("views/workspace/TaskDetail.vue"),
    reader = compactSource("components/routes/RouteReader.vue"),
    steps = compactSource("components/routes/RouteStepList.vue");
  expect(detail.match(/<RouteReader\b/g)).toHaveLength(1);
  expect(reader.match(/<RouteGraph\b/g)).toHaveLength(1);
  expect(reader).toContain(':editable="false"');
  expect(detail).toContain("originalRouteIndex(candidates.value, routeId)");
  expect(detail).toContain("route_index: index");
  expect(detail).toContain("/api/v1/route-documents/from-task");
  expect(detail).toContain('@edit="edit"');
  expect(steps).toContain("$emit('edit', choice.route.route_id)");
  expect(steps).toContain("choice.materials.slice(0, 3)");
  expect(detail).not.toContain("/api/results/update");
  expect(detail).not.toContain("@update:graph");
});
test("generation guard, URL reset, timer cleanup and nonoverlapping inspector remain wired", () => {
  const detail = compactSource("views/workspace/TaskDetail.vue"),
    reader = compactSource("components/routes/RouteReader.vue");
  expect(detail).toContain("disposed || current !== generation");
  expect(detail).toContain("disposed || id !== identifier.value");
  expect(detail).toMatch(/watch\(\s*\(\) => route\.params\.id/);
  expect(detail).toContain("job.value = null; candidates.value = []");
  expect(detail).toContain("generation++; window.clearInterval(timer)");
  expect(reader).toContain("retainedRouteId(values, selectedId.value)");
  expect(reader).toContain(
    ".reader-detail-body > :deep(.route-inspector) { position: static;",
  );
});
