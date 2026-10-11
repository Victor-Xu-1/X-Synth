import { mount } from "@vue/test-utils";
import DeliveryReviewBadge from "./DeliveryReviewBadge.vue";
import { initializeLocale, setLocale } from "@/i18n";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "@babel/parser";

const modelReceipt = () => ({
  version: 1, phase: "automated_review", basis: "route_receipt", grade: "model_checked",
  independent_review: { status: "checked", review_version: 2, model: "graph2smiles_uspto_stereo", matched_steps: 2, total_steps: 2 },
  purchase_identity: { policy: "defined_purchase_identity_v1", status: "defined", unresolved_materials: [] },
});
const options = { global: { stubs: { VIcon: { template: "<i />" } } } };

test("every grade icon resolves through the existing production catalog", () => {
  const source = readFileSync(resolve(__dirname, "DeliveryReviewBadge.vue"), "utf8");
  const names = source.match(/mdi-[a-z-]+/g);
  expect(names).toHaveLength(3);
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
