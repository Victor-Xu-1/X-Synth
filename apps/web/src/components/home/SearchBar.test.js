const fs = require("fs");
const path = require("path");

const searchBarPath = path.resolve(__dirname, "SearchBar.vue");

function readSearchBar() {
  return fs.readFileSync(searchBarPath, "utf8");
}

test("home search bar only converts typed SMILES and no longer opens a duplicate drawer", () => {
  const text = readSearchBar();

  expect(text).toContain("SMILES 输入");
  expect(text).toContain("输入 SMILES 后点击结构转换");
  expect(text).toContain("结构转换");
  expect(text).toContain('class="pa-0 search-bar-column"');
  expect(text).toContain(".search-bar-row :deep(.v-input)");
  expect(text).not.toContain('md="9"');
  expect(text).toContain('data-cy="home-structure-convert"');
  expect(text).toContain('const emit = defineEmits(["structure-convert"]);');
  expect(text).toContain('emit("structure-convert", nextSmiles);');
  expect(text).toContain('<v-combobox');
  expect(text).toContain('smilesInput.value = value || "";');
  expect(text).not.toContain('v-slot:prepend');
  expect(text).not.toContain('home-NIH-resolver');
  expect(text).not.toContain("DrawButton");
  expect(text).not.toContain("home-canonicalize");
  expect(text).not.toContain(">标准化</v-btn>");
});
