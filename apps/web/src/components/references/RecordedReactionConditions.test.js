/** @jest-environment node */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse, compileScript, compileTemplate } from "@vue/compiler-sfc";
import { recordedParameter } from "@/common/reference-evidence";

const record = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      "../../../../../tests/fixtures/reactions/ord-astra-zeneca.json",
    ),
    "utf8",
  ),
);

test("deposited conditions retain source quantities, precision and reagent roles", () => {
  expect(recordedParameter(record.conditions.temperature[0])).toBe(
    "110 ± 10 °C",
  );
  expect(recordedParameter(record.conditions.inputs[0].amounts[0])).toBe(
    "0.00222 mol",
  );
  expect(record.conditions.inputs).toHaveLength(5);
  expect(
    record.conditions.inputs.some((item) => item.role === "CATALYST"),
  ).toBe(true);
});

test("the actual Vue component compiles with missing-value states and molecular images", () => {
  const source = readFileSync(
    resolve(__dirname, "RecordedReactionConditions.vue"),
    "utf8",
  );
  const parsed = parse(source);
  expect(parsed.errors).toEqual([]);
  const script = compileScript(parsed.descriptor, {
    id: "recorded-conditions",
  });
  const template = compileTemplate({
    source: parsed.descriptor.template.content,
    filename: "RecordedReactionConditions.vue",
    id: "recorded-conditions",
    compilerOptions: { bindingMetadata: script.bindings },
  });
  expect(template.errors).toEqual([]);
  expect(source).toContain(':smiles="input.smiles"');
  expect(source).toContain("<StructurePreview");
  expect(script.bindings.StructurePreview).toBeDefined();
  expect(source).toContain("试剂、催化剂与溶剂：未记录");
  expect(source).not.toContain("分离收率");
});
