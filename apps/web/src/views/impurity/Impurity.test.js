import { randomUUID } from "node:crypto";
import { defineComponent, nextTick, reactive, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { useRoute } from "vue-router";
import { API } from "@/common/api";
import { calculationStubs } from "../assessment/test-support";
import WorkbenchForm from "@/components/workspace/WorkbenchForm.vue";
import Impurity from "./Impurity.vue";
import { acceptsImpurities, createForm, impurityBody } from "./impurity-form";

jest.mock("vue-router", () => ({ useRoute: jest.fn() }));
jest.mock("@/common/api", () => ({ API: { post: jest.fn() } }));
jest.mock("@/components/SmilesImage.vue", () => ({
  name: "SmilesImage",
  template: "<div />",
}));
jest.mock("@/components/ModuleWorkbench.vue", () => ({
  name: "ModuleWorkbench",
  template: "<slot />",
}));
jest.mock("./ImpurityStructureEditor.vue", () => ({
  name: "ImpurityStructureEditor",
  template: "<div />",
}));

// Canvas state only; no scientific model result is fabricated or loaded here.
const canvasStub = defineComponent({
  name: "ImpurityStructureEditor",
  props: ["modelValue", "label", "disabled"],
  emits: ["update:modelValue", "dirty"],
  setup(props, { expose }) {
    const pending = ref(false),
      read = jest.fn(async () => props.modelValue);
    expose({ pending, read });
    return { pending };
  },
  template: `<textarea :value="modelValue" :disabled="disabled" :aria-label="label" @input="$emit('update:modelValue', $event.target.value); $emit('dirty', true)" />`,
});
const stubs = { ...calculationStubs, ImpurityStructureEditor: canvasStub };
const wrappers = [],
  originalRandomUUID = crypto.randomUUID;
beforeAll(() => {
  if (!originalRandomUUID)
    Object.defineProperty(crypto, "randomUUID", {
      value: randomUUID,
      configurable: true,
    });
});
afterAll(() => {
  if (!originalRandomUUID) delete crypto.randomUUID;
});
beforeEach(() => {
  API.post.mockReset();
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
});

async function setup(
  query = { reactants: "CC(=O)Cl", known_product: "CNC(C)=O" },
) {
  const route = reactive({ query });
  useRoute.mockReturnValue(route);
  const wrapper = mount(Impurity, { global: { stubs } });
  wrappers.push(wrapper);
  return { wrapper, route };
}

test("shared form keeps material parameters separate from the guarded native canvas", async () => {
  const { wrapper } = await setup({});
  const form = wrapper.getComponent(WorkbenchForm);
  expect(wrapper.findAll("form")).toHaveLength(1);
  expect(form.element.children[0].tagName).toBe("ASIDE");
  expect(form.findAll("aside")).toHaveLength(1);
  expect(form.get(".workbench-inspector").attributes("aria-label")).toBe(
    "杂质分析参数",
  );
  expect(
    form.get(".workbench-inspector > .impurity-parameters").element.tagName,
  ).toBe("DIV");
  expect(form.get(".workbench-input-area .impurity-canvas").exists()).toBe(
    true,
  );
  expect(form.find(".impurity-results-section").exists()).toBe(false);
  const event = new Event("submit", { bubbles: true, cancelable: true });
  form.element.dispatchEvent(event);
  await flushPromises();
  expect(event.defaultPrevented).toBe(true);
  expect(form.emitted("submit")).toEqual([[event]]);
  expect(API.post).not.toHaveBeenCalled();
});

test("an empty form and structure-only prefill never calculate automatically", async () => {
  const { wrapper } = await setup({});
  expect(wrapper.get("textarea").element.value).toBe("");
  await wrapper.get("form").trigger("submit");
  expect(API.post).not.toHaveBeenCalled();
  expect(wrapper.find(".impurity-result").exists()).toBe(false);
});

test("unapplied drawing changes block inference and record switching", async () => {
  const { wrapper } = await setup();
  wrapper
    .getComponent({ name: "ImpurityStructureEditor" })
    .vm.$emit("dirty", true);
  await nextTick();
  expect(wrapper.get('[aria-label="编辑主产物 1"]').element.disabled).toBe(
    true,
  );
  await wrapper.get("form").trigger("submit");
  expect(API.post).not.toHaveBeenCalled();
});

test("pending file or canvas state prevents inference", async () => {
  const { wrapper } = await setup();
  wrapper.getComponent({ name: "ImpurityStructureEditor" }).vm.pending = true;
  await nextTick();
  await wrapper.get("form").trigger("submit");
  expect(API.post).not.toHaveBeenCalled();
});

test("query changes invalidate a pending error without a second request", async () => {
  const { wrapper, route } = await setup();
  let reject;
  API.post.mockReturnValue(
    new Promise((_, failure) => {
      reject = failure;
    }),
  );
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(API.post).toHaveBeenCalledTimes(1);
  route.query = { reactants: "CCO", known_product: "CC=O" };
  await nextTick();
  reject(new Error("prior request interrupted"));
  await flushPromises();
  expect(wrapper.get("textarea").element.value).toBe("CCO");
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  expect(wrapper.find(".impurity-result").exists()).toBe(false);
  expect(API.post).toHaveBeenCalledTimes(1);
});

test("provider failure is visible and never rendered as a successful empty prediction", async () => {
  const { wrapper } = await setup();
  API.post.mockRejectedValue(
    new Error(JSON.stringify({ detail: "正向模型服务不可用。" })),
  );
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toBe("正向模型服务不可用。");
  expect(wrapper.find(".impurity-result").exists()).toBe(false);
});

test("body preserves full salt records and rejects empty added materials", () => {
  const form = createForm();
  form.reactants[0].smiles = " [Na+].CC(=O)[O-] ";
  form.knownProduct[0].smiles = "CC(=O)O";
  expect(impurityBody(form).reactants).toEqual(["[Na+].CC(=O)[O-]"]);
  form.reagents.push({ id: "test-empty-record", smiles: "" });
  expect(() => impurityBody(form)).toThrow("空记录");
});

test.each([0, 11, 1.5, "invalid"])(
  "candidate count %s is rejected before requesting a model",
  (count) => {
    expect(() => impurityBody({ ...createForm(), count })).toThrow("1 至 10");
  },
);

test.each([null, undefined, {}, []])(
  "an absent or malformed response is not a successful prediction",
  (value) => {
    expect(acceptsImpurities(value)).toBeFalsy();
  },
);
