const fs = require("fs");
const path = require("path");

const searchSheetPath = path.resolve(__dirname, "SearchSheet.vue");

function readSearchSheet() {
  return fs.readFileSync(searchSheetPath, "utf8");
}

test("workbench shell does not add a decorative outer frame", () => {
  const text = readSearchSheet();

  expect(text).toContain('<div class="synon-workbench-shell">');
  expect(text).toContain("background: transparent;");
  expect(text).toContain("box-shadow: none;");
  expect(text).toContain("overflow: visible;");
  expect(text).not.toContain("<v-sheet");
  expect(text).not.toContain("border: 1px solid");
  expect(text).not.toContain("radial-gradient");
  expect(text).not.toContain("linear-gradient");
  expect(text).not.toContain("rgba(0, 122, 255, 0.12)");
});
