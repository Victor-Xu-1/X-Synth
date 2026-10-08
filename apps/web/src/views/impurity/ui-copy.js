import { uiText } from "@/i18n";

const nativeModes = {
  1: "常规正向候选", 2: "过度反应", 3: "二聚化", 4: "溶剂加成", 5: "部分反应物组合",
};
const nativeNotices = new Set([
  "结果为可能杂质的模型候选，不是检测结果、杂质含量或实验成功率。",
  "已知主产物为用户输入基准，未将原生 insp_score=1 当作预测或实验评分。",
  "五模式复用 ASKCOS；单个组合最多取 3 个正向候选，FF 阈值沿用 0.2（首候选保留）。",
  "过度反应、二聚化与溶剂加成沿用 >30% 原子保留判据；未匹配片段不放行。",
  "按最佳来源的序列对数评分 + ln(max(FF, 1e-30)) 启发式排序；结构相似度仅作同分次排序。",
  "联合评分不是经校准的成功率、风险、浓度或检出概率。",
  "FF 对重复单体的指纹区分有限；该边界不被映射检查或相似度消除。",
  "FF 服务当前不返回模型文件哈希；记录实际服务模型名称，不编造资产标识。",
]);

export function impurityModeLabel(origin) {
  return nativeModes[origin.mode] === origin.mode_label ? uiText(origin.mode_label) : origin.mode_label;
}
export function impurityNotice(value) {
  return nativeNotices.has(value) ? uiText(value) : value;
}
