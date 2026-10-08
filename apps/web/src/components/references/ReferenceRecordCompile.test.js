/** @jest-environment node */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileScript, compileStyle, compileTemplate, parse } from "@vue/compiler-sfc";

test.each([
  "ReferenceResults.vue",
  "RecordedReactionConditions.vue",
  "ReferenceRecordActions.vue",
  "ReferenceRecordSummary.vue",
  "ReferenceRecordDetail.vue",
  "ReferenceRecordYields.vue",
])("owned component compiles its script, template and scoped styles: %s", (filename) => {
  const source = readFileSync(resolve(__dirname, filename), "utf8");
  const { descriptor, errors } = parse(source, { filename });
  expect(errors).toEqual([]);
  const script = compileScript(descriptor, { id: filename });
  const template = compileTemplate({
    source: descriptor.template.content, filename, id: filename,
    compilerOptions: { bindingMetadata: script.bindings },
  });
  expect(template.errors).toEqual([]);
  for (const style of descriptor.styles) {
    expect(style.scoped).toBe(true);
    expect(compileStyle({ source: style.content, filename, id: filename, scoped: true }).errors).toEqual([]);
  }
});
