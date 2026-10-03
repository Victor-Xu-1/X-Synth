import dagre from "@dagrejs/dagre";
import { graphFromCandidate } from "./route-graph.js";
const list = (value) => (Array.isArray(value) ? value : []);
const strings = (value) =>
  list(value).filter((item) => typeof item === "string" && item.trim());
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const fields = (value, names) =>
  names.flatMap(([key, label]) => {
    const item = value?.[key];
    return (typeof item === "string" && item.trim()) || finite(item)
      ? [{ label, value: item }]
      : [];
  });
export function taskIdentifier(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value)
    ? value
    : "";
}
export function readSelectedRoutes(response) {
  const routes = response?.result?.unified_route_pool?.selected_routes;
  if (routes == null) return [];
  if (
    !Array.isArray(routes) ||
    routes.some(
      (route) =>
        !route ||
        typeof route.route_id !== "string" ||
        !route.route_id.trim() ||
        typeof route.target_smiles !== "string" ||
        !route.target_smiles.trim() ||
        !Array.isArray(route.steps) ||
        route.steps.some(
          (step) =>
            !step ||
            typeof step.product !== "string" ||
            !step.product.trim() ||
            !Array.isArray(step.precursors) ||
            step.precursors.some(
              (smiles) => typeof smiles !== "string" || !smiles.trim(),
            ),
        ),
    )
  )
    throw new Error("候选路线记录格式无效。");
  return routes;
}
export function engineLabel(engine) {
  if (typeof engine === "string" && engine.startsWith("ASKCOS / "))
    return `单步分析 · ${engine.slice(9)}`;
  return (
    {
      askcos_mcts: "树搜索 · MCTS",
      askcos_retro_star: "启发式搜索 · RetroStar",
      askcos_history: "历史搜索",
    }[engine] ||
    (typeof engine === "string" && engine.trim() ? engine : "来源未记录")
  );
}
export function closureLabel(route) {
  if (route?.metadata?.historical_unreviewed) return "历史未复核";
  return route?.closed === true
    ? "库存闭合"
    : route?.closed === false
      ? "未闭合"
      : "闭合未记录";
}
export function confidenceText(value) {
  return finite(value) && value >= 0 && value <= 1
    ? value.toFixed(3)
    : "未记录";
}
export function candidateChoices(
  routes,
  { query = "", engine = "", closure = "", sort = "rank" } = {},
) {
  const search = query.trim().toLocaleLowerCase();
  const choices = list(routes).map((route, originalIndex) => ({
    route,
    originalIndex,
    stepCount: list(route.steps).length,
  }));
  const matching = choices.filter(({ route, originalIndex }) => {
    if (engine && route.engine !== engine) return false;
    if (closure && route.closed !== (closure === "closed")) return false;
    const text = [
      String(originalIndex + 1),
      `R${originalIndex + 1}`,
      route.route_id,
      engineLabel(route.engine),
      route.target_smiles,
      ...strings(route.starting_materials),
      ...strings(route.closure_sources),
      ...strings(route.evidence_refs),
      ...list(route.steps).flatMap((step) => [
        step.product,
        step.reaction_smiles,
        ...strings(step.precursors),
      ]),
    ]
      .join(" ")
      .toLocaleLowerCase();
    return !search || text.includes(search);
  });
  return matching.sort((a, b) => {
    if (sort === "steps")
      return a.stepCount - b.stepCount || a.originalIndex - b.originalIndex;
    if (sort === "score") {
      const first = finite(a.route.route_score)
        ? a.route.route_score
        : -Infinity;
      const second = finite(b.route.route_score)
        ? b.route.route_score
        : -Infinity;
      if (first !== second) return second - first;
    }
    return a.originalIndex - b.originalIndex;
  });
}
export function originalRouteIndex(routes, routeId) {
  return list(routes).findIndex((route) => route.route_id === routeId);
}
export function retainedRouteId(choices, routeId) {
  return choices.some((choice) => choice.route.route_id === routeId)
    ? routeId
    : choices[0]?.route.route_id || "";
}
export function longestLinearSteps(candidate) {
  const value = graphFromCandidate(candidate),
    graph = new dagre.graphlib.Graph();
  value.nodes.forEach((node) => graph.setNode(node.id, node));
  value.edges.forEach((edge) => graph.setEdge(edge.source, edge.target));
  if (!dagre.graphlib.alg.isAcyclic(graph)) return null;
  const lengths = new Map();
  for (const id of dagre.graphlib.alg.topsort(graph)) {
    const upstream = (graph.predecessors(id) || []).map((parent) =>
      lengths.get(parent),
    );
    lengths.set(
      id,
      Math.max(0, ...upstream) + Number(graph.node(id).type === "reaction"),
    );
  }
  return lengths.get(value.target_id) ?? null;
}
export function stepDetails(candidate, graph) {
  const nodes = list(graph?.nodes),
    edges = list(graph?.edges);
  return list(candidate?.steps).map((step, index) => {
    const nodeId =
      nodes.find(
        (node) => node.id === `r-${index + 1}` && node.type === "reaction",
      )?.id || null;
    const productId =
      edges.find((edge) => edge.source === nodeId)?.target || null;
    const incoming = new Set(
      edges.filter((edge) => edge.target === nodeId).map((edge) => edge.source),
    );
    const check = candidate.metadata?.forward_validation_steps?.[index];
    const method = candidate.metadata?.forward_validation_method;
    return {
      record: step,
      number: index + 1,
      nodeId,
      product: { smiles: step.product, nodeId: productId },
      precursors: strings(step.precursors).map((smiles) => ({
        smiles,
        nodeId:
          nodes.find(
            (node) =>
              node.type === "molecule" &&
              node.smiles === smiles &&
              incoming.has(node.id),
          )?.id || null,
      })),
      confidence: confidenceText(step.confidence),
      validation:
        typeof check === "boolean"
          ? `${method === "native_template_reconstruction" ? "模板重构" : "步骤验证"} ${check ? "通过" : "未通过"}`
          : "",
    };
  });
}
export function nodeChoices(graph) {
  const nodes = list(graph?.nodes),
    edges = list(graph?.edges);
  return [...nodes]
    .sort(
      (a, b) =>
        Number(b.id === graph.target_id) - Number(a.id === graph.target_id),
    )
    .map((node) => {
      const kind =
        node.id === graph.target_id
          ? "目标分子"
          : node.type === "reaction"
            ? node.label || "反应"
            : edges.some((edge) => edge.target === node.id)
              ? "中间体"
              : "起始原料";
      return { value: node.id, label: `${kind} · ${node.id}` };
    });
}
export function forwardEvidence(candidate) {
  const metadata = candidate?.metadata || {},
    facts = [];
  const method = metadata.forward_validation_method;
  if (typeof method === "string" && method.trim())
    facts.push({
      label: "验证方法",
      value:
        method === "native_template_reconstruction" ? "模板重构一致性" : method,
    });
  if (typeof metadata.forward_validation_passed === "boolean")
    facts.push({
      label:
        method === "native_template_reconstruction" ? "模板重构" : "验证记录",
      value: metadata.forward_validation_passed ? "通过" : "未通过",
    });
  if (typeof metadata.full_forward_prediction_validated === "boolean")
    facts.push({
      label: "独立正向预测",
      value: metadata.full_forward_prediction_validated ? "已验证" : "未验证",
    });
  return [
    ...facts,
    ...fields(metadata, [["forward_validation_min_score", "验证最低分"]]),
  ];
}
export function modelEvidence(step) {
  return list(step?.metadata?.model_metadata)
    .filter((model) => model && typeof model === "object")
    .map((model) => [
      ...fields(model, [
        ["backend", "后端"],
        ["model_name", "模型"],
        ["direction", "方向"],
        ["rank", "模型排名"],
        ["model_score", "模型分数"],
        ["normalized_model_score", "归一化模型分数"],
        ["reaction_id", "反应记录"],
        ["reaction_set", "反应集"],
      ]),
      ...fields(model.source?.template, [
        ["_id", "模板 ID"],
        ["index", "模板序号"],
        ["template_set", "模板集"],
        ["num_examples", "模板样例数"],
        ["reaction_smarts", "模板 SMARTS"],
      ]),
    ])
    .filter((facts) => facts.length);
}
export function recordEvidence(record) {
  return fields(record, [
    ["source", "步骤来源"],
    ["route_id", "路线 ID"],
    ["engine", "引擎"],
    ["route_score", "路线评分"],
    ["family_key", "反应家族"],
  ]);
}
