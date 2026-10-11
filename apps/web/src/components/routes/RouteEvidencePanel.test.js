import { flushPromises, mount } from "@vue/test-utils";
import { setLocale } from "@/i18n";
import RouteEvidencePanel from "./RouteEvidencePanel.vue";

const step = { source: "askcos:exact_match:ORD", metadata: { model_metadata: [{
  backend: "exact_match", model_name: "ORD", reaction_id: "ord-59c178d093644ada8b89fd56b0d7d294",
  source: { reaction_data: { snapshot: "5".repeat(64), provenance: {
    source: "ORD", dataset_id: "ord_dataset-e7830cd6b11158b43994ccfb5ee9acb3",
    dataset_name: "Training data from https://doi.org/10.1039/C8SC04228D",
    source_sha256: "4".repeat(64),
  } } },
}] } };

test("reader-fix saved dataset attribution is readable without opening raw JSON and never implies target-reaction proof", async () => {
  const before = JSON.stringify(step);
  const wrapper = mount(RouteEvidencePanel, { props: { step } });
  const section = wrapper.get(".saved-dataset-provenance");
  expect(section.text()).toContain(step.metadata.model_metadata[0].source.reaction_data.provenance.dataset_name);
  expect(section.get('a').attributes()).toMatchObject({
    href: "https://doi.org/10.1039/C8SC04228D", target: "_blank", rel: "noopener noreferrer",
  });
  expect(section.get('a').text()).toContain("\u6570\u636e\u96c6\u5f15\u7528");
  expect(section.text()).not.toContain("Yield");
  setLocale("en", { persist: false }); await flushPromises();
  expect(section.text()).toContain("Saved dataset provenance");
  expect(section.text()).toContain("not a publication match, conditions or yield for this target reaction");
  expect(section.get('a').text()).toContain("Dataset citation");
  expect(JSON.stringify(step)).toBe(before);
  wrapper.unmount();
});

test("reader-fix absent stored dataset evidence does not create a citation section", () => {
  const wrapper = mount(RouteEvidencePanel, { props: { step: { source: "original", metadata: {} } } });
  expect(wrapper.find(".saved-dataset-provenance").exists()).toBe(false);
  expect(wrapper.find("a").exists()).toBe(false);
  wrapper.unmount();
});
