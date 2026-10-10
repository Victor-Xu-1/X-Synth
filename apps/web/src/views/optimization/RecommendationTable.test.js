import { readFileSync } from "node:fs";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { setLocale } from "@/i18n";
import RecommendationTable from "./RecommendationTable.vue";
jest.mock("./optimization.css", () => ({}));

// Presentation protocol fixture only; no scientific acceptance claim.
const result = {
  recommendations: [{ conditions: { factor: "unmeasured" }, posterior_mean: 0, posterior_std: 1 }],
  target: { name: "response", unit: "recorded-unit", direction: "minimize" },
  versions: { baybe: "0.15.0" }, selected_rows: [1, 2, 3], warnings: ["Not experimentally confirmed."],
  unique_measured_conditions: 3, best_observed: 0,
};

test("recommendation table styling applies without a workbench ancestor", () => {
  const style = document.createElement("style");
  style.textContent = readFileSync(`${__dirname}/optimization.css`, "utf8");
  document.head.append(style);
  const wrapper = mount(RecommendationTable, { props: { result }, attachTo: document.body,
    global: { stubs: { VIcon: true, RouterLink: true } },
  });
  try {
    expect(wrapper.element.closest(".optimization-workspace")).toBeNull();
    expect(getComputedStyle(wrapper.get("th").element).padding).toBe("9px 10px");
    expect(getComputedStyle(wrapper.get("table").element).width).toBe("100%");
    expect(wrapper.get('[role="region"]').attributes("tabindex")).toBe("0");
    expect(wrapper.text()).toContain("未实验确认");
    expect(wrapper.text()).toContain("recorded-unit");
    expect(wrapper.text()).toContain("最小化");
  } finally { wrapper.unmount(); style.remove(); }
});

const systemWarnings = [
  "建议条件尚未实验确认；后验标准差是模型对潜在响应的不确定性，不是实验误差或成功概率。",
  "分类因子使用独热编码；没有结构描述符、机理或文献约束。候选组合的安全性与可操作性需专业核验。",
  "当前实测记录少于 10 条，模型预测与不确定性可能不稳定。",
  "部分后验均值超出收率物理范围；未裁剪预测，不能作为实验收率。",
];

test("exact engine warnings follow the shared language without mutating the saved result", async () => {
  const known = { ...result, warnings: [...systemWarnings] };
  const snapshot = JSON.stringify(known);
  setLocale("en", { persist: false });
  const wrapper = mount(RecommendationTable, { props: { result: known } });
  try {
    expect(wrapper.findAll('.opt-scientific-notes p').map((node) => node.text())).toEqual([
      "Suggested conditions have not been experimentally confirmed. Posterior standard deviation describes model uncertainty about the latent response, not experimental error or a probability of success.",
      "Categorical factors use one-hot encoding; no molecular descriptors, mechanistic constraints or literature constraints are included. Candidate combinations require professional checks for safety and practical feasibility.",
      "Fewer than 10 measured records are available; model predictions and uncertainty estimates may be unstable.",
      "Some posterior means fall outside the physical range of yield. Predictions have not been clipped and must not be treated as experimental yields.",
    ]);
    expect(JSON.stringify(known)).toBe(snapshot);
    setLocale("zh-CN", { persist: false });
    await nextTick();
    expect(wrapper.findAll('.opt-scientific-notes p').map((node) => node.text())).toEqual(systemWarnings);
    expect(JSON.stringify(known)).toBe(snapshot);
  } finally { wrapper.unmount(); }
});

test("unknown warnings and scientific labels stay verbatim even when they are registered UI phrases", async () => {
  const warnings = ["已就绪", "Candidate source: pH 7.4, 5.0 mol/L", `${systemWarnings[0]} source-specific qualifier`];
  const known = { ...result, warnings,
    target: { ...result.target, name: "未实验确认", unit: "已就绪" },
    recommendations: [{ conditions: { "已就绪": "未实验确认", "Temperature / °C": 25 }, posterior_mean: 0, posterior_std: 1 }],
    csv_content: "factor,response\r\nsource,0\r\n",
  };
  const snapshot = JSON.stringify(known);
  setLocale("en", { persist: false });
  const wrapper = mount(RecommendationTable, { props: { result: known } });
  try {
    expect(wrapper.findAll('.opt-scientific-notes p').map((node) => node.text())).toEqual(warnings);
    expect(wrapper.findAll("thead th").map((node) => node.text())).toContain("已就绪");
    expect(wrapper.get(".opt-response-identity").text()).toContain("未实验确认");
    expect(wrapper.get(".opt-response-identity").text()).toContain("已就绪");
    expect(wrapper.findAll("tbody td").map((node) => node.text())).toEqual(["未实验确认", "25", "0", "1"]);
    setLocale("zh-CN", { persist: false });
    await nextTick();
    expect(wrapper.findAll('.opt-scientific-notes p').map((node) => node.text())).toEqual(warnings);
    expect(JSON.stringify(known)).toBe(snapshot);
  } finally { wrapper.unmount(); }
});
