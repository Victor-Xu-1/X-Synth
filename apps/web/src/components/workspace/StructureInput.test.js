const fs = require("fs");
const path = require("path");
const { compileScript, compileTemplate, parse } = require("@vue/compiler-sfc");

test("structure input defaults to an inline board below the compact SMILES field", () => {
  const filename = path.resolve(__dirname, "StructureInput.vue");
  const text = fs.readFileSync(filename, "utf8");
  const { descriptor, errors } = parse(text, { filename });
  expect(errors).toEqual([]);
  const script = compileScript(descriptor, { id: "structure-input" });
  expect(
    compileTemplate({
      filename,
      id: "structure-input",
      source: descriptor.template.content,
      compilerOptions: { bindingMetadata: script.bindings },
    }).errors,
  ).toEqual([]);
  expect(text).not.toContain("<details");
  expect(text).not.toContain("<SmilesImage");
  expect(text.indexOf("<textarea")).toBeLessThan(
    text.indexOf("<InlineKetcherEditor"),
  );
  expect(text).toContain('rows="2"');
  expect(text.replace(/\s+/g, " ")).toContain("auto-sync compact fill-height");
  expect(text).toContain("useIntersectionObserver");
  expect(text).toContain("editor.value.pending");
  expect(text).toContain(':read-structure="read"');
});
