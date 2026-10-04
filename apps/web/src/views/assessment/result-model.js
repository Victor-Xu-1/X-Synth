export function metricValue(value, digits = 3) {
  return value === null || value === undefined ? "未定义" :
    new Intl.NumberFormat("zh-CN", { maximumFractionDigits: digits }).format(value);
}

export const finiteOrNull = (value) => value === null || (typeof value === "number" && Number.isFinite(value));
export const validIdentity = (value) => value && typeof value.smiles === "string" && value.smiles.length > 0 &&
  typeof value.formula === "string" && typeof value.molecular_weight_g_mol === "number" &&
  Number.isFinite(value.molecular_weight_g_mol);
const textList = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");

export function acceptsAssessment(value) {
  return value?.scope === "molecular_descriptors_only" && typeof value.rdkit_version === "string" &&
    validIdentity(value.structure) && value.descriptors &&
    ["h_bond_donors", "h_bond_acceptors", "tpsa_angstrom2", "logp_crippen", "rotatable_bonds", "rings", "aromatic_rings", "fraction_csp3", "potential_stereocenters", "unassigned_stereocenters"].every((key) => typeof value.descriptors[key] === "number" && Number.isFinite(value.descriptors[key])) &&
    Array.isArray(value.components) && value.components.length > 0 && value.components.every((item) =>
      validIdentity(item.structure) && item.metrics && ["sa_score", "sps", "nsps", "bertz_ct"].every((key) => finiteOrNull(item.metrics[key])) && textList(item.notices)) &&
    textList(value.notices) && Array.isArray(value.methods);
}
