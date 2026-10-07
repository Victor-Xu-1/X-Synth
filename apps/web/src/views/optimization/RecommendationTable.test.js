import { readFileSync } from "node:fs";
import { mount } from "@vue/test-utils";
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
