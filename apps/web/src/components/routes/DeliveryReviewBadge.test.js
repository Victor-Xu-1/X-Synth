import { mount } from "@vue/test-utils";
import DeliveryReviewBadge from "./DeliveryReviewBadge.vue";
import { initializeLocale, setLocale, uiText } from "@/i18n";
import readerMessages from "@/i18n/catalog-routes-reader";
import { deliveryReviewLabels } from "@/common/delivery-review";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "@babel/parser";

const modelReceipt = () => ({
  version: 1, phase: "automated_review", basis: "route_receipt", grade: "model_checked",
  independent_review: { status: "checked", review_version: 2, model: "graph2smiles_uspto_stereo", matched_steps: 2, total_steps: 2 },
  purchase_identity: { policy: "defined_purchase_identity_v1", status: "defined", unresolved_materials: [] },
});
const operationReceipt = () => ({
  ...modelReceipt(), grade: "operation_evidence_required",
  operations: { policy: "template_operation_evidence_v1", status: "evidence_required",
    unresolved_steps: [{ step_id: "原始步骤 A", reasons: ["原始条件 25 °C", "[NH4+].[Cl-]"] }] },
});
const options = { global: { stubs: { VIcon: { props: ["icon"], template: "<i :data-icon=\"icon\" />" } } } };

test("every grade icon resolves through the existing production catalog", () => {
  const source = readFileSync(resolve(__dirname, "DeliveryReviewBadge.vue"), "utf8");
  const names = source.match(/mdi-[a-z-]+/g);
  expect(names).toHaveLength(7);
  const catalog = parse(readFileSync(resolve(__dirname, "../../plugins/icons-catalog.js"), "utf8"), { sourceType: "module" });
  const declaration = catalog.program.body.find(node => node.type === "ExportNamedDeclaration"
    && node.declaration?.declarations?.some(item => item.id.name === "iconPaths"));
  const initializer = declaration.declaration.declarations[0].init;
  const object = initializer.type === "CallExpression" ? initializer.arguments[0] : initializer;
  const registered = object.properties.map(item => item.key.value);
  for (const name of names) expect(registered).toContain(name);
});

test("English defaults and the saved Chinese choice use the shared language authority", async () => {
  localStorage.removeItem("x-synth.locale");
  initializeLocale();
  const value = modelReceipt(), before = JSON.stringify(value);
  const wrapper = mount(DeliveryReviewBadge, { ...options, props: { receipt: value } });
  expect(wrapper.text()).toBe("Model checked");
  setLocale("zh-CN");
  await wrapper.vm.$nextTick();
  expect(wrapper.text()).toBe("模型已核验");
  expect(localStorage.getItem("x-synth.locale")).toBe("zh-CN");
  initializeLocale();
  await wrapper.vm.$nextTick();
  expect(wrapper.text()).toBe("模型已核验");
  expect(JSON.stringify(value)).toBe(before);
  wrapper.unmount();
});

test("legacy and unresolved grades remain compact and explicit", async () => {
  setLocale("en");
  const wrapper = mount(DeliveryReviewBadge, options);
  expect(wrapper.text()).toBe("Not independently reviewed");
  const value = modelReceipt();
  value.grade = "purchase_form_unresolved";
  value.purchase_identity.status = "unresolved";
  value.purchase_identity.unresolved_materials = [{ smiles: "O=C([O-])[O-]", reason: "undefined_purchase_form" }];
  await wrapper.setProps({ receipt: value });
  expect(wrapper.text()).toBe("Purchase form unresolved");
  expect(wrapper.attributes("data-delivery-grade")).toBe("purchase_form_unresolved");
  expect(wrapper.text()).not.toMatch(/experiment|qualified|ready/i);
  wrapper.unmount();
});

test("operation grade has one exact bilingual entry in the existing route catalog", () => {
  const source = deliveryReviewLabels.operation_evidence_required;
  expect(source).toBe("反应操作待核验");
  expect(readerMessages.filter(([key]) => key === source))
    .toEqual([[source, "Reaction operations unverified"]]);
  initializeLocale(null);
  expect(uiText(source)).toBe("Reaction operations unverified");
  setLocale("zh-CN", { persist: false });
  expect(uiText(source)).toBe("反应操作待核验");
});

test("operation warning uses default English and preserves saved Chinese and raw evidence on reopening", async () => {
  localStorage.removeItem("x-synth.locale");
  initializeLocale();
  const value = operationReceipt(), before = JSON.stringify(value);
  let wrapper = mount(DeliveryReviewBadge, { ...options, props: { receipt: value } });
  expect(wrapper.text()).toBe("Reaction operations unverified");
  expect(wrapper.attributes("data-delivery-grade")).toBe("operation_evidence_required");
  expect(wrapper.get("i").attributes("data-icon")).toBe("mdi-flask-outline");
  expect(wrapper.text()).not.toMatch(/template|policy|step|record|experiment|ready|operation_evidence/i);
  setLocale("zh-CN");
  await wrapper.vm.$nextTick();
  expect(wrapper.text()).toBe("反应操作待核验");
  expect(localStorage.getItem("x-synth.locale")).toBe("zh-CN");
  initializeLocale();
  await wrapper.vm.$nextTick();
  expect(wrapper.text()).toBe("反应操作待核验");
  wrapper.unmount();
  initializeLocale();
  wrapper = mount(DeliveryReviewBadge, { ...options, props: { receipt: value } });
  expect(wrapper.text()).toBe("反应操作待核验");
  setLocale("en");
  await wrapper.vm.$nextTick();
  expect(wrapper.text()).toBe("Reaction operations unverified");
  expect(JSON.stringify(value)).toBe(before);
  wrapper.unmount();
});

test("operation badge reacts to priority, malformed evidence and removal without creating a review", async () => {
  setLocale("en");
  const wrapper = mount(DeliveryReviewBadge, { ...options, props: { receipt: operationReceipt() } });
  expect(wrapper.attributes("data-delivery-grade")).toBe("operation_evidence_required");
  const value = operationReceipt();
  value.grade = "purchase_form_unresolved";
  value.purchase_identity.status = "unresolved";
  value.purchase_identity.unresolved_materials = [{ smiles: "O=C([O-])[O-]", reason: "undefined_purchase_form" }];
  await wrapper.setProps({ receipt: value });
  expect(wrapper.text()).toBe("Purchase form unresolved");
  await wrapper.setProps({ receipt: { ...value, operations: { ...value.operations, unresolved_steps: [] } } });
  expect(wrapper.text()).toBe("Not independently reviewed");
  expect(wrapper.attributes("data-delivery-grade")).toBe("not_independently_reviewed");
  await wrapper.setProps({ receipt: modelReceipt() });
  expect(wrapper.text()).toBe("Model checked");
  await wrapper.setProps({ receipt: null });
  expect(wrapper.text()).toBe("Not independently reviewed");
  wrapper.unmount();
});

const selectedReview = (status = "ready") => ({
  version: 1, phase: "automated_review", basis: "selected_routes", status,
  grade: status === "ready" ? "mixed_review" : "not_independently_reviewed",
  route_count: status === "ready" ? 3 : null,
  grade_counts: status === "ready" ? { not_independently_reviewed: 0, model_checked: 1,
    operation_evidence_required: 2, purchase_form_unresolved: 0 } : null,
  source_binding: { job_id: "private-task-id", snapshot_id: "a".repeat(64) },
});

test.each([
  ["pending", "Review pending", "汇总待更新", "mdi-progress-clock"],
  ["unavailable", "Review unavailable", "汇总不可用", "mdi-alert-circle-outline"],
  ["ready", "Mixed review", "混合核验", "mdi-shield-outline"],
])("%s aggregate remains compact, bilingual and free of engineering identifiers", async (status, en, zh, icon) => {
  localStorage.setItem("x-synth.locale", "invalid-choice");
  initializeLocale();
  const value = selectedReview(status), before = JSON.stringify(value);
  let wrapper = mount(DeliveryReviewBadge, { ...options, props: { receipt: value } });
  expect(wrapper.text()).toBe(en);
  expect(wrapper.get("i").attributes("data-icon")).toBe(icon);
  expect(wrapper.attributes("data-delivery-status")).toBe(status);
  expect(wrapper.html()).not.toContain("private-task-id");
  expect(wrapper.html()).not.toContain("a".repeat(64));
  expect(wrapper.text()).not.toMatch(/experiment|certified|approved|success|cache|hash/i);
  setLocale("zh-CN");
  await wrapper.vm.$nextTick();
  expect(wrapper.text()).toBe(zh);
  wrapper.unmount();
  initializeLocale();
  wrapper = mount(DeliveryReviewBadge, { ...options, props: { receipt: value } });
  expect(wrapper.text()).toBe(zh);
  expect(JSON.stringify(value)).toBe(before);
  wrapper.unmount();
});

test("mixed tooltip names only nonzero selected-route counts and reacts to language and grade changes", async () => {
  setLocale("en");
  const wrapper = mount(DeliveryReviewBadge, { ...options, props: { receipt: selectedReview() } });
  expect(wrapper.text()).toBe("Mixed review");
  expect(wrapper.attributes("title")).toBe("Selected routes: Model checked: 1; Reaction operations unverified: 2");
  expect(wrapper.attributes("aria-label")).toContain("Mixed review");
  expect(wrapper.attributes("tabindex")).toBe("0");
  setLocale("zh-CN");
  await wrapper.vm.$nextTick();
  expect(wrapper.attributes("title")).toBe("已选路线: 模型已核验: 1; 反应操作待核验: 2");
  await wrapper.setProps({ receipt: selectedReview("pending") });
  expect(wrapper.attributes("title")).toBeUndefined();
  expect(wrapper.attributes("tabindex")).toBeUndefined();
  await wrapper.setProps({ receipt: { ...selectedReview(), route_count: 4 } });
  expect(wrapper.text()).toBe("未独立核验");
  expect(wrapper.attributes("data-delivery-status")).toBeUndefined();
  expect(wrapper.attributes("title")).toBeUndefined();
  wrapper.unmount();
});

test("legacy model summaries are explicitly saved reviews, not current comprehensive checks", async () => {
  const value = { ...modelReceipt(), basis: "stored_summary", independent_review: {
    status: "checked", selected_routes: 1, accepted_routes: 2,
    review_policy: "exact_stock_graph2smiles_connected_dag_family_queue_v3",
  } };
  setLocale("en");
  const wrapper = mount(DeliveryReviewBadge, { ...options, props: { receipt: value } });
  expect(wrapper.text()).toBe("Saved model review");
  setLocale("zh-CN");
  await wrapper.vm.$nextTick();
  expect(wrapper.text()).toBe("保存的模型核验");
  await wrapper.setProps({ receipt: modelReceipt() });
  expect(wrapper.text()).toBe("模型已核验");
  wrapper.unmount();
});

test("aggregate and saved-review labels have one exact bilingual catalog authority", () => {
  for (const entry of [["保存的模型核验", "Saved model review"], ["汇总待更新", "Review pending"],
    ["汇总不可用", "Review unavailable"], ["混合核验", "Mixed review"], ["已选路线", "Selected routes"]])
    expect(readerMessages.filter(([key]) => key === entry[0])).toEqual([entry]);
});
