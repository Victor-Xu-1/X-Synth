import { CalculationInputError } from "@/views/assessment/useCalculation";
import { reactionInputText } from "@/common/reaction-input";

const requireText = (value) => {
  if (typeof value !== "string" || !value.trim()) throw new CalculationInputError("历史预测缺少确定的结构输入。");
  return value;
};
export function predictionReplay(input, kind) {
  const limit = kind === "conditions" ? 20 : 10;
  if (!Number.isInteger(input?.count) || input.count < 1 || input.count > limit)
    throw new CalculationInputError("历史预测的候选数量无效。");
  const reactants = requireText(input.reactants);
  if (kind === "forward") return { reactants, count: input.count };
  const product = requireText(input.product), context = input.reaction_context;
  if (context !== undefined && (!context || typeof context.reaction_smiles !== "string" || context.selected_product !== product))
    throw new CalculationInputError("完整反应上下文与历史预测不一致。");
  return {
    count: input.count, product,
    reaction: context ? requireText(context.reaction_smiles) : reactionInputText({ reactants, product }),
    note: context ? "" : "该历史记录未保存完整画板；仅恢复提交模型的反应物与选定产物。",
  };
}
