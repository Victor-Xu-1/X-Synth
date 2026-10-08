import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileStyle, parse } from "@vue/compiler-sfc";
import postcss from "postcss";

const directory = resolve(process.cwd(), "src/components/routes");
const stylesheet = (name) => postcss.parse(readFileSync(resolve(directory, name), "utf8"));
function declarations(css, selector) {
  const result = {};
  css.walkRules(selector, (rule) => {
    if (rule.parent.type === "root") rule.walkDecls((decl) => { result[decl.prop] = decl.value; });
  });
  return result;
}

test.each([
  ["RouteReader.vue", "route-reader.css"],
  ["RouteStepList.vue", "route-step-list.css"],
])("%s compiles its scoped modular stylesheet", (component, filename) => {
  const { descriptor } = parse(readFileSync(resolve(directory, component), "utf8"));
  expect(descriptor.styles.find((style) => style.src === `./${filename}`)?.scoped).toBe(true);
  expect(compileStyle({
    filename, id: "data-v-route-reading", scoped: true,
    source: readFileSync(resolve(directory, filename), "utf8"),
  }).errors).toEqual([]);
});

test("step selection is an inset marker and cannot change structural dimensions", () => {
  const css = stylesheet("route-step-list.css");
  const active = declarations(css, ".route-step.active");
  expect(active["box-shadow"]).toContain("inset");
  for (const property of ["padding", "margin", "width", "border-left"])
    expect(active[property]).toBeUndefined();
  expect(declarations(css, ".step-molecule")["border-radius"]).toBe("6px");
});

test("reader tabs have stable touch heights and do not consume a side canvas column", () => {
  const css = stylesheet("route-reader.css");
  expect(declarations(css, ".reader-route-tabs button").height).toBe("44px");
  expect(declarations(css, ".reader-tool-rail > .v-btn").height).toBe("48px");
  expect(declarations(css, ".reader-detail-body")["grid-template-columns"]).toBe("minmax(0, 1fr) auto");
  expect(declarations(css, ".reader-route-tabs")["overflow-x"]).toBe("auto");
});

test("whole-route thumbnails reclaim the checkbox column and do not force a tall empty mobile canvas", () => {
  const reader = stylesheet("route-reader.css"), steps = stylesheet("route-step-list.css");
  expect(declarations(reader, ".reader-overview-entry")["grid-template-columns"]).toBeUndefined();
  expect(declarations(reader, ".route-choice-check").position).toBe("absolute");
  expect(declarations(reader, ".reader-overview-entry :deep(.route-overview header)")["padding-left"]).toBe("36px");
  expect(declarations(steps, ".overview-route-graph").height).toBeUndefined();
  expect(declarations(steps, ".overview-route-graph")["min-height"]).toBe("160px");
});

test("reader surfaces use shared theme tokens and fixed, nonnegative type spacing", () => {
  for (const filename of ["route-reader.css", "route-step-list.css"])
    stylesheet(filename).walkDecls((decl) => {
      if (decl.prop === "background") expect(decl.value).toContain("var(--ws-");
      if (decl.prop === "font-size") expect(decl.value).not.toMatch(/vw|vh|cqw/);
      if (decl.prop === "letter-spacing") expect(decl.value).toBe("0");
    });
});
