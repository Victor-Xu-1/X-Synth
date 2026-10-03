/** @jest-environment node */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  compileScript,
  compileStyle,
  compileTemplate,
  parse,
} from "@vue/compiler-sfc";

test("backend inventory compiles with the actual Vue compiler and retains read-only capability boundaries", () => {
  const filename = "BackendInventory.vue";
  const source = readFileSync(resolve(__dirname, filename), "utf8");
  const { descriptor, errors } = parse(source, { filename });
  expect(errors).toEqual([]);
  const script = compileScript(descriptor, { id: "backend-inventory" });
  expect(
    compileTemplate({
      filename,
      id: "backend-inventory",
      source: descriptor.template.content,
      compilerOptions: { bindingMetadata: script.bindings },
    }).errors,
  ).toEqual([]);
  for (const style of descriptor.styles)
    expect(
      compileStyle({
        filename,
        id: "data-v-backend-inventory",
        source: style.content,
        scoped: style.scoped,
      }).errors,
    ).toEqual([]);
  expect(source).not.toContain("<button");
  expect(source).toContain("源码模块");
  expect(source).toContain("runtime_verified");
  expect(source).toContain("configured");
});
