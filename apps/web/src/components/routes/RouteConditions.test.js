import { mount } from "@vue/test-utils";
import RouteConditions from "./RouteConditions.vue";
import { setLocale } from "@/i18n";

jest.mock("@/common/route-reading", () => ({ conditionRows: jest.fn() }));
jest.mock("@/store/workspace", () => ({ useWorkspaceStore: () => ({ can: () => false }) }));
jest.mock("@/components/SmilesImage.vue", () => ({ template: '<div />' }));
jest.mock("@/components/references/ReactionReferences.vue", () => ({ template: '<div />' }));
jest.mock("./RouteConditionDialog.vue", () => ({ template: '<div />' }));
import { conditionRows } from "@/common/route-reading";

test("step details forward the original keyboard and pointer events without predictions", () => {
  conditionRows.mockReturnValue([{ nodeId: "original-step", number: 1, confidence: "0", reactants: ["C"], product: "CO",
    evidence: { conditions: [], links: [] },
  }]);
  const wrapper = mount(RouteConditions, { global: { stubs: { VBtn: true } } });
  try {
    const events = [0, 1].map(detail => new MouseEvent("click", { bubbles: true, detail }));
    events.forEach(event => wrapper.get("header button").element.dispatchEvent(event));
    expect(wrapper.emitted("select").map(([id]) => id)).toEqual(["original-step", "original-step"]);
    events.forEach((event, index) => expect(wrapper.emitted("select")[index][1]).toBe(event));
    expect(wrapper.findComponent({ name: "RouteConditionDialog" }).exists()).toBe(false);
  } finally { wrapper.unmount(); }
});

test("reader-fix condition reader labels saved dataset citation without filling missing experimental conditions", () => {
  setLocale("en", { persist: false });
  conditionRows.mockReturnValue([{ nodeId: "r-1", number: 1, confidence: "1.000", reactants: ["CN1CCNCC1"], product: "CCO",
    evidence: { conditions: [], links: [], dataset: { fields: [
      { label: "\u6570\u636e\u96c6", value: "Training data from https://doi.org/10.1039/C8SC04228D" },
    ], links: [{ key: "dataset-doi", type: "dataset", label: "\u6570\u636e\u96c6\u5f15\u7528", href: "https://doi.org/10.1039/C8SC04228D", value: "10.1039/C8SC04228D" }] } },
  }]);
  const wrapper = mount(RouteConditions, { global: { stubs: { VBtn: true } } });
  expect(wrapper.text()).toContain("The original route has no recorded experimental conditions");
  expect(wrapper.get('.saved-dataset-provenance a').text()).toContain("Dataset citation");
  expect(wrapper.text()).toContain("not a publication match, conditions or yield for this target reaction");
  expect(wrapper.find('.condition-fields').exists()).toBe(false);
  wrapper.unmount();
});

test("stored ORD attribution remains readable without a DOI and does not become experimental conditions", () => {
  setLocale("en", { persist: false });
  conditionRows.mockReturnValue([{ nodeId: "r-1", number: 1, confidence: "1.000", reactants: ["C"], product: "CO",
    evidence: { conditions: [], links: [], dataset: { fields: [
      { label: "数据集", value: "Original dataset title" },
      { label: "许可", value: "CC-BY-SA-4.0" },
      { label: "原始反应 ID", value: "original-record" },
    ], links: [] } },
  }]);
  const wrapper = mount(RouteConditions, { global: { stubs: { VBtn: true } } });
  const section = wrapper.get('.saved-dataset-provenance');
  expect(section.text()).toContain("Original dataset title");
  expect(section.text()).toContain("CC-BY-SA-4.0");
  expect(section.get('.dataset-details').attributes("open")).toBeUndefined();
  expect(section.get('.dataset-details').text()).toContain("original-record");
  expect(section.find('a').exists()).toBe(false);
  expect(wrapper.find('.condition-fields').exists()).toBe(false);
  wrapper.unmount();
});
