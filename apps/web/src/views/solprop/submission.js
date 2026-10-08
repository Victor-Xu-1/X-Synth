const models = Object.freeze({
  solprop: { label: "Fusion Cycle", endpoint: '/api/solubility/fusion-cycle/call-async' },
  fastsolv: { label: "FastSolv", endpoint: '/api/fastsolv/call-async' },
  legacy: { label: "SolProp", endpoint: '/api/solubility/batch/call-async' },
});

function snapshot(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(snapshot));
  if (value && typeof value === "object") {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshot(item)])));
  }
  return value;
}

const optional = (value) => value === "" || value == null ? null : value;

export function solubilityInput(values) {
  return {
    solute: values.solute, solvent: values.solvent, temp: values.temperature,
    density: values.density, ref_solvent: values.refSolvent, ref_solubility: values.refSolubility,
    ref_temp: values.refTemperature, hsub298: values.soluteHsub,
    cp_gas_298: values.soluteCpg, cp_solid_298: values.soluteCps,
  };
}

export function createSolubilitySubmission(model, data, sourceName = null) {
  if (!Object.hasOwn(models, model)) throw new RangeError();
  if (!Array.isArray(data) || !data.length || data.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
    throw new TypeError();
  }
  const inputs = data.map((item) => ({
    solvent: item.solvent ?? item.solvent_smiles ?? "",
    solute: item.solute ?? item.solute_smiles ?? "",
    temp: Object.hasOwn(item, "temp") ? item.temp : item.temperature ?? 298,
    ref_solvent: optional(item.ref_solvent), ref_solubility: optional(item.ref_solubility),
    ref_temp: optional(item.ref_temp), hsub298: optional(item.hsub298),
    cp_gas_298: optional(item.cp_gas_298), cp_solid_298: optional(item.cp_solid_298),
  }));
  let body;
  if (model === "legacy") body = { task_list: inputs };
  else {
    body = {
      solvent_smiles: inputs.map((item) => item.solvent),
      solute_smiles: inputs.map((item) => item.solute),
      temperature: inputs.map((item) => item.temp),
    };
    const densities = data.map((item) => optional(item.density) == null ? null : Number(item.density));
    if (model === "solprop" && densities.some((density) => density != null && !Number.isFinite(density))) throw new TypeError();
    if (model === "solprop" && densities.some((density) => density != null)) body.density = densities;
  }
  return snapshot({ model, modelLabel: models[model].label, endpoint: models[model].endpoint, body, sourceName });
}

export function createScreenSubmission(values, solvents, temperatures) {
  const input = solubilityInput(values);
  const requests = temperatures.map((temp) => createSolubilitySubmission("legacy",
    solvents.map((solvent) => ({ ...input, solvent, temp }))));
  if (!requests.length) throw new TypeError();
  return snapshot({ solute: input.solute, solvents, temperatures, model: "legacy", requests });
}

export function annotateSolubilityOutput(submission, output) {
  if (!Array.isArray(output) || output.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
    throw new TypeError();
  }
  const densities = submission.body.density;
  // Density is positional in this endpoint's request; refuse an ambiguous correspondence.
  if (densities && output.length && densities.length !== output.length) throw new TypeError();
  return output.map((item, index) => {
    const result = { ...item, model: submission.modelLabel };
    if (densities?.[index] != null) result.density = densities[index];
    return result;
  });
}

export async function runSolubilitySubmission(submission, signal, runTask) {
  if (signal.aborted) return [];
  const output = await runTask(submission.endpoint, submission.body, undefined, { signal });
  if (signal.aborted) return [];
  return annotateSolubilityOutput(submission, output);
}
