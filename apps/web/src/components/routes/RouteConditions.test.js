import { mount } from "@vue/test-utils";
import RouteConditions from "./RouteConditions.vue";
import { setLocale } from "@/i18n";

jest.mock("@/common/route-reading", () => ({ conditionRows: jest.fn() }));
jest.mock("@/store/workspace", () => ({ useWorkspaceStore: () => ({ can: () => false }) }));
jest.mock("@/components/SmilesImage.vue", () => ({ template: '<div />' }));
jest.mock("@/components/references/ReactionReferences.vue", () => ({ template: '<div />' }));
jest.mock("./RouteConditionDialog.vue", () => ({ template: '<div />' }));
import { conditionRows } from "@/common/route-reading";

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
