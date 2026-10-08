import { uiText } from "@/i18n";

const controlledNotices = new Set([
  "尚未确认投料边界完整（含试剂、溶剂、水与后处理物料）。", "产物：缺少分离总质量。",
  "产物：缺少质量纯度，纯产物质量与纯度校正指标未定义。", "限量原料：计算摩尔收率需要结构与质量。",
  "未指定限量原料与计量系数，摩尔收率未定义。", "理论产物质量为零：计算收率未定义。",
  "分离产物质量为零：PMI 分母为零，不返回无穷大或零 PMI。", "产物质量纯度为零：纯度校正 PMI 未定义。",
  "已录入投料质量为零；不视为无物料消耗的工艺。",
  "计算收率超过 100%：请核对限量原料、计量系数、质量纯度及单位；不是放大预测。",
  "仅核算用户录入批次；不验证反应计量、完整路线或预测工艺放大。",
  "PMI 使用分离产物总质量；纯度校正 PMI 单列，质量纯度不是 HPLC 面积纯度。",
  "回收物不从总投料 PMI 自动扣除；输入减产物的差额不是实测废物或 E-factor。",
  "分子量按完整结构记录计算，保留盐、同位素与立体化学；不自动换成游离形式。",
  "理论产物质量使用用户指定的限量原料和计量系数；不自动判断限量关系或反应是否配平。",
]);
const rowNotice = /^(反应物|试剂|催化剂|溶剂|水|辅助物料|实测废物|回收物|副产物) (\d+)：(缺少质量。|未提供结构，不推断化学身份或分子量。)$/;

export function processNotice(value) {
  if (controlledNotices.has(value)) return uiText(value);
  const match = typeof value === "string" && rowNotice.exec(value);
  if (!match) return value;
  return uiText(match[3] === "缺少质量。" ? "{role} {index}：缺少质量。" : "{role} {index}：未提供结构，不推断化学身份或分子量。",
    { role: uiText(match[1]), index: match[2] });
}

export function processMessage(value) {
  const match = typeof value === "string" && /^(.*)必须是有限的非负数。$/.exec(value);
  return match ? uiText("{label}必须是有限的非负数。", { label: uiText(match[1]) }) : uiText(value);
}
