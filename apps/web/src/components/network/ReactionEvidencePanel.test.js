import { mount } from "@vue/test-utils";
import ReactionEvidencePanel from "@/components/network/ReactionEvidencePanel.vue";

test("renders clickable patent links and reaction conditions", () => {
  const wrapper = mount(ReactionEvidencePanel, {
    props: {
      evidenceInput: {
        reactionData: {
          patent_number: "WO2024/59806; A1",
          reagent: "BCl3",
          solvent: "DCM",
          temperature: "0 C - 20 C",
          yield: "52%",
          procedure: "Boron trichloride was added to a stirring solution.",
        },
      },
    },
  });

  expect(wrapper.text()).toContain("证据来源");
  expect(wrapper.text()).toContain("反应条件");
  expect(wrapper.text()).toContain("BCl3");
  expect(wrapper.text()).toContain("DCM");
  expect(wrapper.find('a[href="https://patents.google.com/patent/WO2024059806A1"]').exists()).toBe(true);
});

test("stays hidden when no evidence exists", () => {
  const wrapper = mount(ReactionEvidencePanel, {
    props: {
      evidenceInput: {
        reactionData: {},
      },
    },
  });

  expect(wrapper.find(".reaction-evidence-panel").exists()).toBe(false);
});
