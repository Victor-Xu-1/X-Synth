import { mount } from "@vue/test-utils";
import { initializeLocale, setLocale } from "@/i18n";
import { sourceEvidence } from "@/common/document-source-evidence.test-support";
import { savedForwardFacts, savedStepReferences } from "@/common/saved-step-evidence";
import RouteSavedStepEvidence from "./RouteSavedStepEvidence.vue";

test("saved review follows the actual raw step ID, never display order or r-N", async () => {
  const evidence = sourceEvidence(), automatedReview = evidence.metadata.automated_review;
  const wrapper = mount(RouteSavedStepEvidence, { props: { automatedReview, step: evidence.steps_by_node["r-2"] } });
  expect(wrapper.text()).toContain("exact-ORD"); expect(wrapper.text()).toContain("saved-forward");
  expect(wrapper.text()).toContain("原始模型排名");
  await wrapper.setProps({ step: evidence.steps_by_node["r-1"] });
  expect(wrapper.find("section").exists()).toBe(false);
  await wrapper.setProps({ step: { step_id: "r-2" } });
  expect(wrapper.find("section").exists()).toBe(false); wrapper.unmount();
});
test("thin references retain reaction/product scope and display only actual saved source fields and values", () => {
  const evidence = sourceEvidence(), before = JSON.stringify(evidence);
  const wrapper = mount(RouteSavedStepEvidence, { props: { automatedReview: evidence.metadata.automated_review,
    step: evidence.steps_by_node["r-2"] } });
  const exact = wrapper.get('[data-match-scope="reaction_identity"]'), product = wrapper.get('[data-match-scope="product_identity"]');
  expect(exact.text()).toContain("保存的全反应匹配"); expect(product.text()).toContain("保存的产物匹配");
  expect(exact.text()).toContain("conditions.temperature.setpoint.value"); expect(exact.text()).toContain("52 %");
  expect(product.text()).toContain("不能证明此反应的条件或收率");
  expect(product.find(".saved-reference-fields").exists()).toBe(false);
  expect(wrapper.findComponent({ name: "ReferenceResults" }).exists()).toBe(false);
  expect(wrapper.findComponent({ name: "ReferenceRecordDetail" }).exists()).toBe(false);
  expect(wrapper.get("a").attributes()).toMatchObject({ href: "https://doi.org/10.1234/example", rel: "noopener noreferrer", target: "_blank" });
  expect(JSON.stringify(evidence)).toBe(before); wrapper.unmount();
});
test("ambiguous, unrelated, invalid links and presence flags cannot manufacture review or measured values", () => {
  const review = sourceEvidence().metadata.automated_review;
  review.forward.records.push({ ...review.forward.records[0] });
  expect(savedForwardFacts(review, "early-original")).toEqual([]);
  expect(savedForwardFacts(review, "not-recorded")).toEqual([]);
  const refs = review.references.records[0].refs;
  refs[0].url = "javascript:alert(1)"; refs[0].reaction_yield_measurements.push({ value: 95 });
  refs[1].match_scope = "unknown";
  const projected = savedStepReferences(review, "early-original");
  expect(projected[0].href).toBeNull(); expect(projected[0].yields).toHaveLength(1);
  expect(projected[1].matchLabel).toBe("匹配范围未记录");
  review.references.records.push({ ...review.references.records[0] });
  expect(savedStepReferences(review, "early-original")).toEqual([]);
});
test("historical joint rank and current original rank remain distinct without re-ranking", () => {
  const review = sourceEvidence().metadata.automated_review;
  expect(savedForwardFacts(review, "early-original")).toContainEqual({ label: "原始模型排名", value: 2 });
  review.version = 3;
  delete review.forward.records[0].rank_provenance;
  expect(savedForwardFacts(review, "early-original")).toContainEqual({ label: "历史联合排名", value: 2 });
  review.version = 99;
  expect(savedForwardFacts(review, "early-original").some(fact => fact.label.includes("排名"))).toBe(false);
});
test("fresh English and Chinese use the shared authority without rewriting stored chemistry or source data", async () => {
  initializeLocale(null);
  const evidence = sourceEvidence(), before = JSON.stringify(evidence);
  const wrapper = mount(RouteSavedStepEvidence, { props: { automatedReview: evidence.metadata.automated_review,
    step: evidence.steps_by_node["r-2"] } });
  expect(wrapper.text()).toContain("Saved step review"); expect(wrapper.text()).toContain("Recorded product-only match");
  expect(wrapper.text()).toContain("52 %"); expect(wrapper.text()).toContain("CCCl");
  setLocale("zh-CN", { persist: false }); await wrapper.vm.$nextTick();
  expect(wrapper.text()).toContain("已保存的步骤核验"); expect(wrapper.text()).toContain("52 %");
  expect(JSON.stringify(evidence)).toBe(before); wrapper.unmount();
});

test.each([-0.1, 1.1, Infinity, NaN, "0.9"])("invalid saved FF score %s is not presented as a valid model score", score => {
  const review = sourceEvidence().metadata.automated_review;
  review.forward.records[0].feasibility_score = score;
  expect(savedForwardFacts(review, "early-original").some(fact => fact.label === "反应模型评分（FF）")).toBe(false);
  expect(Object.is(review.forward.records[0].feasibility_score, score)).toBe(true);
});
