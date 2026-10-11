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
  expect(names).toHaveLength(4);
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
