const fs = require("fs");
const path = require("path");
const { parse, compileScript, compileTemplate } = require("@vue/compiler-sfc");
const views = [
  "login/Login.vue",
  "login/AdminLogin.vue",
  "login/SSOLogin.vue",
  "login/SSOCallback.vue",
  "login/SSOLogout.vue",
  "admin/Admin.vue",
  "admin/AccountUserDialog.vue",
  "drawing/Drawing.vue",
  "forward/Forward.vue",
  "solprop/SolProp.vue",
  "qm/QM.vue",
  "banlist/Banlist.vue",
  "notfound/NotFound.vue",
];
const read = (file) =>
  fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");
test("retired unreachable error view stays removed", () => {
  expect(fs.existsSync(path.resolve(__dirname, "../error/Error.vue"))).toBe(false);
});
test.each(views)("compiles owned UI %s without legacy ornaments", (file) => {
  const source = read(file);
  const { descriptor, errors } = parse(source, { filename: file });
  expect(errors).toEqual([]);
  if (descriptor.script || descriptor.scriptSetup)
    compileScript(descriptor, { id: file });
  const result = compileTemplate({
    source: descriptor.template.content,
    filename: file,
    id: file,
  });
  expect(result.errors).toEqual([]);
  expect(source).not.toMatch(
    /vanta|vantaRef|linear-gradient|radial-gradient|assets\/(emptyDraw|qm|banlist)\.svg/,
  );
});
test("drawing preserves genuine Ketcher and real committed previews", () => {
  const source = read("drawing/Drawing.vue");
  expect(source).toContain("InlineKetcherEditor");
  expect(source).toContain("readSmilesFromEditor()");
  expect(source).toContain('@commit="commitStructure"');
  expect(source).toContain("/api/rdkit/canonicalize");
  expect(source).toContain(':smiles="committedSmiles"');
  expect(source).toContain('workspace.can("drawing")');
});
test.each([
  "forward/Forward.vue",
  "solprop/SolProp.vue",
  "qm/QM.vue",
  "banlist/Banlist.vue",
  "admin/Admin.vue",
])("keeps %s behind real workspace capability checks", (file) => {
  expect(read(file)).toContain("useWorkspaceStore");
  expect(read(file)).toContain("workspace.can(");
});
test("Forward has one URL-derived mode and retains query inputs", () => {
  const source = read("forward/Forward.vue");
  expect(source).toContain("const mode = computed(() => tab.value)");
  expect(source).toContain("query: { ...route.query, tab: value }");
  expect(source).not.toMatch(/changeMode|tab.value =/);
});

test("QM loads 3Dmol only after a real structure response, without old network dependencies", () => {
  const source = read("qm/QM.vue");
  expect(source).not.toMatch(/import[^\n]+from ['"]3dmol['"]/);
  expect(source).toContain('const renderer = await import("3dmol")');
  expect(source.indexOf('await import("3dmol")')).toBeGreaterThan(
    source.indexOf("await fetchSDFfromSMILES(rowData.smiles)"),
  );
  expect(source).toContain("visualizeMolecule(sdf, createViewer)");
});
test.each([
  "forward/Forward.vue",
  "solprop/SolProp.vue",
  "qm/QM.vue",
  "drawing/Drawing.vue",
  "admin/Admin.vue",
  "banlist/Banlist.vue",
])("%s does not import removed network or store implementations", (file) => {
  expect(read(file)).not.toMatch(
    /from ['"][^'"]*(views\/network|stores?\/resultstore|resultstoreloader|vis-network|vis-data|jspanel|vue-confetti|vanta)/,
  );
});
