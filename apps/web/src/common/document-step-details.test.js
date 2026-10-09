import { documentStepDetails } from "./document-step-details";

const molecule = (id, smiles) => ({ id, type: "molecule", smiles, label: "", note: "", position: { x: 10, y: 20 } });
const reaction = id => ({ id, type: "reaction", label: "original reaction", note: "unchanged note", position: { x: 30, y: 40 } });
const graph = () => ({ target_id: "target", nodes: [reaction("later"), molecule("target", "CCO"), molecule("salt", "[Na+].[O-]C"),
  reaction("earlier"), molecule("start", "[13CH3][C@H](O)Cl"), molecule("middle", "CO")], edges: [
  { id: "a", source: "middle", target: "later" }, { id: "b", source: "salt", target: "later" },
  { id: "c", source: "later", target: "target" }, { id: "d", source: "start", target: "earlier", input_occurrences: 2 },
  { id: "e", source: "earlier", target: "middle" },
] });

test("graph-ID dependency order preserves exact records, multiplicity and the entire original document", () => {
  const value = graph(), original = JSON.stringify(value);
  const steps = documentStepDetails(value);
  expect(steps.map(step => step.node.id)).toEqual(["earlier", "later"]);
  expect(steps.map(step => step.number)).toEqual([1, 2]);
  expect(steps[0].inputs[0]).toEqual({ edge: value.edges[3], node: value.nodes[4], count: 2 });
  expect(steps[0].inputs[0].node.smiles).toBe("[13CH3][C@H](O)Cl");
  expect(steps[1].inputs[1].node.smiles).toBe("[Na+].[O-]C");
  expect(steps[0].product).toBe(value.nodes[5]);
  expect(steps[0].node.label).toBe("original reaction");
  expect(JSON.stringify(value)).toBe(original);
  expect(steps[0]).not.toHaveProperty("score");
  expect(steps[0]).not.toHaveProperty("closed");
});

test("same-SMILES nodes are distinct saved graph records, never merged as candidate products", () => {
  const value = graph(); value.nodes[1].smiles = value.nodes[5].smiles;
  expect(documentStepDetails(value).map(step => step.node.id)).toEqual(["earlier", "later"]);
});

test("draft reactions without connections remain truthful incomplete records", () => {
  const value = { target_id: "m", nodes: [molecule("m", "CCO"), reaction("r")], edges: [] };
  expect(documentStepDetails(value)).toEqual([{ node: value.nodes[1], number: 1, inputs: [], product: null }]);
});

test("cycles, dangling references and malformed repeated-input counts cannot produce plausible steps", () => {
  const cyclic = graph(); cyclic.edges.push({ id: "cycle", source: "target", target: "earlier" });
  expect(() => documentStepDetails(cyclic)).toThrow();
  const missing = graph(); missing.edges[0].source = "missing";
  expect(() => documentStepDetails(missing)).toThrow();
  const repeated = graph(); repeated.edges[3].input_occurrences = 0;
  expect(() => documentStepDetails(repeated)).toThrow();
});

test("empty reaction collections do not invent synthesis or a zero-score claim", () => {
  expect(documentStepDetails({ target_id: "m", nodes: [molecule("m", "CCO")], edges: [] })).toEqual([]);
});

test("invalid record IDs cannot collapse graphlib identities or duplicate a saved edge", () => {
  const numeric = graph(); numeric.nodes[0].id = 5;
  expect(() => documentStepDetails(numeric)).toThrow("路线文档响应格式无效");
  const duplicate = graph(); duplicate.edges[1].id = duplicate.edges[0].id;
  expect(() => documentStepDetails(duplicate)).toThrow("路线文档响应格式无效");
});
