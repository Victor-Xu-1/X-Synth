/** @jest-environment node */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parse,
  compileScript,
  compileTemplate,
  compileStyle,
} from "@vue/compiler-sfc";
const source = readFileSync(
  resolve(__dirname, "WorkspaceSectionNav.vue"),
  "utf8",
);
test("section navigation compiles and uses actual links and capability state only", () => {
  const filename = "WorkspaceSectionNav.vue";
  const { descriptor, errors } = parse(source, { filename });
  expect(errors).toEqual([]);
  const script = compileScript(descriptor, { id: "section-nav" });
  expect(
    compileTemplate({
      filename,
      id: "section-nav",
      source: descriptor.template.content,
      compilerOptions: { bindingMetadata: script.bindings },
    }).errors,
  ).toEqual([]);
  for (const style of descriptor.styles)
    expect(
      compileStyle({
        filename,
        id: "section-nav",
        source: style.content,
        scoped: true,
      }).errors,
    ).toEqual([]);
  expect(source).toContain("workspace.features");
  expect(source).toContain("aria-current");
  expect(source).not.toMatch(
    /fetch\(|API\.|workspace\.refresh|window\.location/,
  );
});
