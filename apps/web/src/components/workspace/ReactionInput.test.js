const fs = require("fs");
const path = require("path");
const { compileScript, compileTemplate, parse } = require("@vue/compiler-sfc");

test.each(["ReactionInput.vue", "ReactionRecordPreview.vue"])(
  "%s compiles as a concrete reaction surface",
  (filename) => {
    const source = fs.readFileSync(path.resolve(__dirname, filename), "utf8");
    const { descriptor, errors } = parse(source, { filename });
    expect(errors).toEqual([]);
    const script = compileScript(descriptor, { id: "reaction-input" });
    expect(
      compileTemplate({
        filename,
        id: "reaction-input",
        source: descriptor.template.content,
        compilerOptions: { bindingMetadata: script.bindings },
      }).errors,
    ).toEqual([]);
  },
);

test("one reaction editor retains native RXN roles and explicit product confirmation", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "ReactionInput.vue"),
    "utf8",
  );
  expect(source.match(/<InlineKetcherEditor\b/g)).toHaveLength(1);
  const files = fs.readFileSync(
    path.resolve(__dirname, "../../composables/useReactionFiles.js"),
    "utf8",
  );
  expect(source).not.toContain("<StructureInput");
  expect(files).toContain("checkedReactionDraft");
  expect(files).toContain("await board.value.exportRxn()");
  expect(source).toContain("await board.value.clearEditor()");
  expect(files).toContain("value.products.length === 1");
  expect(source).toContain('data-cy="reaction-product-choice"');
  expect(files).toContain("original !== text.value");
  expect(files).toContain("identities[role]");
  expect(source).not.toMatch(/\.split\(["'](?:>|\.)["']\)/);
});
