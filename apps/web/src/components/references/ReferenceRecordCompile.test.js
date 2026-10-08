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
  "ReferenceQuerySummary.vue",
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

test("reference detail body can shrink while header and actions remain reachable", () => {
  const source = readFileSync(resolve(__dirname, "ReferenceRecordDetail.vue"), "utf8");
  const { descriptor } = parse(source);
  const styles = descriptor.styles.map(style => style.content).join("\n");
  const body = styles.match(/\.reference-detail-body\s*\{([^}]+)\}/)[1];
  const heading = styles.match(/\.reference-detail-heading\s*\{([^}]+)\}/)[1];
  const footer = styles.match(/\.reference-detail-actions\s*\{([^}]+)\}/)[1];
  expect(body).toMatch(/min-height:\s*0\s*;/);
  expect(body).toMatch(/overflow-y:\s*auto\s*;/);
  expect(heading).toMatch(/flex-shrink:\s*0\s*;/);
  expect(footer).toMatch(/flex-shrink:\s*0\s*;/);
});
