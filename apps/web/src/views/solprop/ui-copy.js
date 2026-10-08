import { uiText } from "@/i18n";

const fields = {
  hsub298: "输入 Hsub298", cp_gas_298: "输入 Cpg298", cp_solid_298: "输入 Cps298",
  st_1: "溶解度（方法 1）[mg/mL]", st_2: "溶解度（方法 2）[mg/mL]", s_298: "298 K 溶解度 [mg/mL]",
  uncertainty_log_s_298: "logS298 不确定度 [log10(mol/L)]", uncertainty: "logS 不确定度 [log10(mol/L)]",
  uncertainty_dg_solv_298: "dGsolv298 不确定度 [kcal/mol]", uncertainty_dh_solv_298: "dHsolv298 不确定度",
  pred_hsub298: "预测 Hsub298 [kcal/mol]", pred_cpg298: "预测 Cpg298 [cal/K/mol]", pred_cps298: "预测 Cps298 [cal/K/mol]",
};

export function solubilityFieldCaption(key, original) {
  return uiText(fields[key] || original);
}

const contextPhrases = new Set([
  "根据溶质、溶剂和温度输入，模型会输出溶解度、热力学描述符和不确定度参考。",
  "预测值用于溶剂筛选和实验设计前评估，正式工艺仍需实测确认。",
]);
export function solubilityContextText(value) {
  return contextPhrases.has(value) ? uiText(value) : value;
}
