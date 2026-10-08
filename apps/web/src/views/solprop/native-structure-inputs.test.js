const fs = require("fs");
const path = require("path");
const { compileScript, compileTemplate, parse } = require("@vue/compiler-sfc");
const { transformSync } = require("@babel/core");

const leaves = [
  ["../../components/banlist/BanItemDialog.vue", 1, "inputPending"],
  ["../qm/QM.vue", 1, "inputPending"],
  ["tabs/SolubilityPredictView.vue", 3, "structurePending"],
  ["tabs/SolventScreenView.vue", 3, "structurePending"],
];
const read = (file) => fs.readFileSync(path.resolve(__dirname, file), "utf8");
const optionsCache = new Map();

function optionsOf(file) {
  if (optionsCache.has(file)) return optionsCache.get(file);
  const { descriptor } = parse(read(file), { filename: file });
  const script = compileScript(descriptor, { id: file });
  const { code } = transformSync(script.content, {
    babelrc: false,
    configFile: false,
    plugins: ["@babel/plugin-transform-modules-commonjs"],
  });
  const module = { exports: {} };
  // Only evaluate component definitions; never load services or invoke lifecycle hooks.
  const inertRequire = (id) => id === "chart.js" ? { Chart: { register() {} } } : {};
  new Function("require", "module", "exports", code)(inertRequire, module, module.exports);
  optionsCache.set(file, module.exports.default);
  return module.exports.default;
}

function solventContext(solvents, selectedSolventIndex = 0) {
  const options = optionsOf(leaves[3][0]);
  return {
    solvents,
    selectedSolventIndex,
    get solventList() { return options.computed.solventList.call(this); },
    solventSet: "custom",
    solventSets: {},
  };
}

test.each(leaves)("compiles molecule-input leaf %s", (file) => {
  const source = read(file);
  const { descriptor, errors } = parse(source, { filename: file });
  expect(errors).toEqual([]);
  const script = compileScript(descriptor, { id: file });
  const result = compileTemplate({
    filename: file,
    id: file,
    source: descriptor.template.content,
    compilerOptions: { bindingMetadata: script.bindings },
  });
  expect(result.errors).toEqual([]);
});

test.each(leaves)("%s adopts the shared input without another editor", (file, count, pending) => {
  const source = read(file);
  expect(source).toContain('import StructureInput from "@/components/workspace/StructureInput.vue"');
  expect(source.match(/<StructureInput\b/g)).toHaveLength(count);
  expect(source).toContain(pending);
  expect(source).toMatch(new RegExp(`if \\([^\\n]*${pending}`));
  expect(source).not.toMatch(/DrawButton|KetcherModal|openKetcher|currentInputSource|<iframe/);
});

test("mixed inputs disable molecule-file controls without parsing reaction strings", () => {
  const ban = read(leaves[0][0]);
  const qm = read(leaves[1][0]);
  expect(ban).toContain(':allow-files="allowMoleculeFiles"');
  expect(ban).toContain('newType.value === "chemicals"');
  expect(qm).toContain(':allow-files="allowMoleculeFiles"');
  expect(qm).toContain('!smiles.value.includes(">")');
  expect(`${ban}\n${qm}`).not.toMatch(/\.split\(["']>/);
  expect(ban).toContain('smiles: newSmiles.value');
  expect(qm).toContain('smiles: [smiles.value.trim()]');
});

test("solvent entries retain the bulk newline contract and use one selected editor", () => {
  const source = read(leaves[3][0]);
  expect(source).toContain("return this.solvents.split('\\n')");
  expect(source).toContain("this.solvents = entries.join('\\n')");
  expect(source).toContain('v-model="selectedSolvent"');
  expect(source).toContain('ref="selectedSolventInput"');
  expect(source).toContain(':key="selectedSolventIndex"');
  expect(source).toContain('v-model="solvents"');
  expect(source).not.toMatch(/\.split\(["'][>.]/);
  expect(source).toContain("this.solventList.map((solvent)");
});

test("native model flows and outer capability gates remain unchanged", () => {
  const qm = read(leaves[1][0]);
  const prediction = read(leaves[2][0]);
  const screening = read(leaves[3][0]);
  expect(qm).toContain('workspace.can("qm")');
  expect(qm).toContain('"/api/qm-descriptors/call-async"');
  expect(prediction).toContain("'/api/solubility/fusion-cycle/call-async'");
  expect(prediction).toContain("'/api/fastsolv/call-async'");
  expect(prediction).toContain("'/api/solubility/batch/call-async'");
  expect(screening).toContain("'/api/solubility/batch/call-async'");
  expect(read("SolProp.vue")).toContain('disabled: !workspace.can("solubility")');
  expect(read("SolProp.vue")).toContain('<template #module="{ value }">');
  expect(read("../banlist/Banlist.vue")).toContain('disabled: !workspace.can("native_account")');
});

test("QM URL prefill only populates and requires explicit submission", () => {
  const source = read(leaves[1][0]);
  const { descriptor } = parse(source, { filename: leaves[1][0] });
  const { scriptSetupAst } = compileScript(descriptor, { id: "qm-prefill" });
  const mounted = scriptSetupAst.filter((node) =>
    node.type === "ExpressionStatement" && node.expression.callee?.name === "onMounted",
  );
  expect(mounted).toHaveLength(1);
  const hook = mounted[0].expression.arguments[0];
  const mountedSource = descriptor.scriptSetup.content.slice(hook.start, hook.end);
  expect(mountedSource).toContain('smiles.value = route.query.smiles');
  expect(mountedSource).toContain('await workspace.refresh()');
  expect(mountedSource).not.toMatch(/\bpredict\b|API\./);
  expect(source).not.toContain('prefillRequest');
  expect(source).toContain('@submit.prevent="predict"');
});

test.each([
  [leaves[2][0], ["soluteInput", "solventInput", "referenceInput"]],
  [leaves[3][0], ["soluteInput", "selectedSolventInput", "referenceInput"]],
])("%s tracks every structure input, including an optional reference", (file, refs) => {
  const pending = optionsOf(file).computed.structurePending;
  const context = Object.fromEntries(refs.map((name) => [name, null]));
  expect(pending.call(context)).toBe(false);
  for (const name of refs) {
    context[name] = { pending: true };
    expect(pending.call(context)).toBe(true);
    context[name] = { pending: false };
    expect(pending.call(context)).toBe(false);
  }
});

test.each([leaves[2][0], leaves[3][0]])("%s rejects pending submission before changing state or calling a model", (file) => {
  const results = ["existing-result"];
  const context = {
    loading: false, structurePending: true, results, pendingTasks: 0,
    solute: "CCO", solvent: "O", selectedModel: "legacy",
  };
  expect(() => optionsOf(file).methods.predict.call(context)).not.toThrow();
  expect(context.loading).toBe(false);
  expect(context.pendingTasks).toBe(0);
  expect(context.results).toBe(results);
});

test("selected solvent edits preserve other raw lines, salts, stereo and trailing empty entries", () => {
  const options = optionsOf(leaves[3][0]);
  const context = solventContext("[Na+].CC(=O)[O-]\nN[C@@H](C)C(=O)O\n[13CH4]\n", 1);
  expect(options.computed.selectedSolvent.get.call(context)).toBe("N[C@@H](C)C(=O)O");
  options.computed.selectedSolvent.set.call(context, "F[C@H](Cl)Br");
  expect(context.solvents).toBe("[Na+].CC(=O)[O-]\nF[C@H](Cl)Br\n[13CH4]\n");
  options.computed.selectedSolvent.set.call(context, "");
  expect(context.solvents).toBe("[Na+].CC(=O)[O-]\n\n[13CH4]\n");
});

test("shorter bulk lists clamp selection without inventing missing entries", () => {
  const options = optionsOf(leaves[3][0]);
  const context = solventContext("O", 4);
  options.watch.solvents.call(context, context.solvents);
  expect(context.selectedSolventIndex).toBe(0);
  expect(options.computed.selectedSolvent.get.call(context)).toBe("O");
  expect(context.solvents).toBe("O");
});

test("editing a preset changes only the working list and selects custom", () => {
  const options = optionsOf(leaves[3][0]);
  const preset = ["O", "CCO"];
  const context = solventContext("O\nCO", 1);
  context.solventSet = "preset";
  context.solventSets = { preset };
  options.watch.solvents.call(context, context.solvents);
  expect(context.solventSet).toBe("custom");
  expect(preset).toEqual(["O", "CCO"]);
  expect(context.solvents).toBe("O\nCO");
});
