/** @jest-environment node */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";
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

test("persistent navigation owns its surface and button styling outside page scrolling", () => {
  const { descriptor } = parse(source);
  const rules = postcss.parse(descriptor.styles[0].content);
  const declarations = selector => Object.fromEntries(
    rules.nodes.find(node => node.selector === selector).nodes
      .filter(node => node.type === "decl").map(node => [node.prop, node.value]),
  );
  expect(declarations(".workspace-section-nav")).toMatchObject({
    "flex-shrink": "0", background: "var(--ws-surface)",
    "min-width": "0", "overflow-x": "auto",
  });
  expect(declarations(".section-more")).toMatchObject({
    "border-radius": "6px", "text-transform": "none", "font-size": "14px",
    "font-weight": "500", "flex-shrink": "0",
  });
});
