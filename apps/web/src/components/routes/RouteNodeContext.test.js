/** @jest-environment node */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  compileScript,
  compileStyle,
  compileTemplate,
  parse,
} from "@vue/compiler-sfc";
const source = (filename) => readFileSync(resolve(__dirname, filename), "utf8");

test.each([
  "RouteNodeContext.vue",
  "RouteConditionDialog.vue",
  "MoleculeStockDialog.vue",
  "RouteInspector.vue",
  "RoutePreview.vue",
  "DocumentPreview.vue",
])("%s compiles with the actual Vue compiler", (filename) => {
  const { descriptor, errors } = parse(source(filename), { filename });
  expect(errors).toEqual([]);
  const script = compileScript(descriptor, { id: "node-context" });
  expect(
    compileTemplate({
      filename,
      id: "node-context",
      source: descriptor.template.content,
      compilerOptions: { bindingMetadata: script.bindings },
    }).errors,
  ).toEqual([]);
  for (const style of descriptor.styles)
    expect(
      compileStyle({
        filename,
        id: "data-v-node-context",
        source: style.content,
        scoped: style.scoped,
      }).errors,
    ).toEqual([]);
});

test("route conditions use the shared predictor and an explicit action without leaving the route", () => {
  const context = source("RouteNodeContext.vue"),
    dialog = source("RouteConditionDialog.vue");
  expect(context).toContain("conditionOpen = true");
  expect(context).toContain("conditionOpen.value = false");
  expect(dialog).toContain("useConditionPrediction");
  expect(dialog).toContain('@click="predict"');
  expect(dialog).not.toMatch(/onMounted\s*\(\s*predict/);
  expect(dialog).toContain(':allow-evaluation="false"');
});

test("inspector validation captures a node/draft and refuses late writes after selection or lifetime changes", () => {
  const inspector = source("RouteInspector.vue");
  expect(inspector).toContain("const node = { ...props.node }");
  expect(inspector).toContain("const draft =");
  expect(inspector).toContain("node.id !== props.node?.id");
  expect(inspector).toContain("current !== generation");
  expect(inspector).toContain("onBeforeUnmount");
  expect(inspector).not.toMatch(/emit\("update",\s*\{\s*\.\.\.props\.node/);
});

test("read-only preview selection is inspected and reset across route/document changes", () => {
  expect(source("RoutePreview.vue")).toContain("<RouteReader");
  for (const filename of ["RouteReader.vue", "DocumentPreview.vue"]) {
    const preview = source(filename);
    expect(preview).toContain("<RouteInspector");
    expect(preview).toContain("@select=");
    expect(preview).toContain(
      filename === "RouteReader.vue"
        ? "selectedNode.value = null"
        : "selected.value = null",
    );
    expect(preview).not.toContain("@update:graph");
  }
});

test("stock records are explicit reads with identity comparison, stale guards and no model calls", () => {
  const stock = source("MoleculeStockDialog.vue");
  expect(stock).toContain('API.post("/api/v1/stock/lookup"');
  expect(stock).toContain("catalogRecordsForInputs(value, [smiles])");
  expect(stock).toContain("snapshot === expectedSnapshot");
  expect(stock).toContain("current !== generation");
  expect(stock).toContain("rows.value = []");
  expect(stock).not.toContain("call-sync");
});
