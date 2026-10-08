import { initializeLocale, setLocale } from "@/i18n";
import { materialRows, materialsCsv, routeLabel } from "@/common/route-reading";
import { engineUiLabel, generatedReactionUiLabel, materialUiLabel, materialUsesUiText } from "./route-ui-text";

test("engine display follows the locale without translating model identifiers or native route labels", () => {
  initializeLocale(null);
  expect(engineUiLabel("askcos_mcts")).toBe("Tree search · MCTS");
  expect(engineUiLabel("askcos_retro_star")).toBe("Heuristic search · RetroStar");
  expect(engineUiLabel("ASKCOS / pistachio_ringbreaker")).toBe("One-step analysis · pistachio_ringbreaker");
  expect(engineUiLabel("ASKCOS / 取消")).toBe("One-step analysis · 取消");
  expect(engineUiLabel("取消")).toBe("取消");
  expect(routeLabel(0)).toBe("R001");
  setLocale("zh-CN", { persist: false });
  expect(engineUiLabel("askcos_mcts")).toBe("树搜索 · MCTS");
  expect(engineUiLabel("ASKCOS / pistachio_ringbreaker")).toBe("单步分析 · pistachio_ringbreaker");
  expect(engineUiLabel("取消")).toBe("取消");
  expect(routeLabel(1)).toBe("R002");
});

test("generated captions use complete phrases while unknown captions remain literal", () => {
  initializeLocale(null);
  expect(generatedReactionUiLabel("步骤 17")).toBe("Step 17");
  expect(generatedReactionUiLabel("反应")).toBe("Reaction");
  expect(generatedReactionUiLabel("未收录的反应标题")).toBe("未收录的反应标题");
  expect(materialUsesUiText({ usedIn: ["步骤 17"] }, {}, true)).toBe("Step 17");
});

test("material fallbacks localize without transforming user names, graph records or exported CSV", () => {
  const graph = {
    target_id: "target", nodes: [
      { id: "target", type: "molecule", smiles: "CCO" },
      { id: "m1", type: "molecule", smiles: "N" },
      { id: "m2", type: "molecule", smiles: "O", label: "原料 2" },
      { id: "r1", type: "reaction" },
      { id: "r2", type: "reaction", label: "反应步骤" },
    ],
    edges: [{ source: "m1", target: "r1" }, { source: "m2", target: "r2" }],
  };
  const rows = materialRows(graph), before = JSON.stringify(graph), csv = materialsCsv(rows);
  initializeLocale(null);
  expect(materialUiLabel(rows[0], 0, graph)).toBe("Starting material 1");
  expect(materialUiLabel(rows[1], 1, graph)).toBe("原料 2");
  expect(materialUsesUiText(rows[0], graph)).toBe("Reaction step");
  expect(materialUsesUiText(rows[1], graph)).toBe("反应步骤");
  setLocale("zh-CN", { persist: false });
  expect(materialUiLabel(rows[0], 0, graph)).toBe("原料 1");
  expect(materialUsesUiText(rows[0], graph)).toBe("反应步骤");
  expect(materialsCsv(rows)).toBe(csv);
  expect(JSON.stringify(graph)).toBe(before);
});
