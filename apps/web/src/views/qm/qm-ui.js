import { uiText } from "@/i18n";

const labels = {
  index: "原子序号", elem: "元素", npa_e: "NPA 电荷 (e)", npa_e_pos: "NPA 正电荷 (e)", npa_e_neg: "NPA 负电荷 (e)",
  npa_parr_func_e_pos: "NPA 正 Parr 函数 (e)", npa_parr_func_e_neg: "NPA 负 Parr 函数 (e)",
  sheilding_constant_ppm: "屏蔽常数 (ppm)", bond_index: "键序号 (无量纲)", bond_length: "键长 (Å)", bond_charge: "键电荷 (e)",
  natural_ion: "自然离子性 (无量纲)", dipole_moment: "偶极矩 (debye)", traceless: "无迹四极矩 (debye⋅Å)",
};

export function qmFieldCaption(key, original) {
  const orbital = /^valence_(1s|2s|2p|3s|3p|4s|4p)$/.exec(key);
  return orbital ? uiText(`${orbital[1]} 价轨道占据 (e)`) : uiText(labels[key] || original);
}
