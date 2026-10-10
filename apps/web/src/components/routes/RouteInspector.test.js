import { flushPromises, mount } from "@vue/test-utils";
import { API } from "@/common/api";
import RouteInspector from "./RouteInspector.vue";
jest.mock("@vueuse/core", () => ({ useResizeObserver: jest.fn() }));

jest.mock("@/common/api", () => ({ API: { post: jest.fn() } }));
jest.mock("@/components/workspace/StructureInput.vue", () => ({
  name: "StructureInput",
  props: ["modelValue", "label", "disabled"],
  emits: ["update:modelValue"],
  setup: () => ({ pending: require("vue").ref(false) }),
  template:
    '<textarea :aria-label="label" :disabled="disabled" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
}));
jest.mock("@/components/SmilesImage.vue", () => ({
  name: "SmilesImage",
  props: ["smiles"],
  template: '<div class="structure-image" />',
}));
jest.mock("./RouteNodeContext.vue", () => ({
  name: "RouteNodeContext",
  template: "<div />",
}));

const node = () => ({
  id: "target",
  type: "molecule",
  smiles: "CCO",
  label: "目标",
  note: "",
  position: { x: 0, y: 0 },
});

test("pending chemical input locks close and cannot be discarded before synchronization finishes", async () => {
  const wrapper = setup();
  wrapper.getComponent({ name: "StructureInput" }).vm.pending = true;
  await flushPromises();
  expect(wrapper.vm.pending).toBe(true);
  expect(wrapper.get('button[aria-label="关闭详情"]').attributes("disabled")).toBeDefined();
  expect(wrapper.vm.discardDraft()).toBe(false);
  expect(wrapper.pendingEvents).toHaveBeenLastCalledWith(true);
  wrapper.getComponent({ name: "StructureInput" }).vm.pending = false;
  await flushPromises();
  expect(wrapper.pendingEvents).toHaveBeenLastCalledWith(false);
});
const wrappers = [];
function setup(props = {}) {
  const pendingEvents = jest.fn();
  const wrapper = mount(RouteInspector, {
    props: {
      node: node(),
      target: true,
      editable: true,
      contextId: "document-a",
      onPending: pendingEvents,
      ...props,
    },
    global: {
      stubs: {
        VDefaultsProvider: { template: "<slot />" },
        VDialog: { props: ["modelValue"], template: '<div v-if="modelValue"><slot /></div>' },
        VTooltip: { template: '<span><slot name="activator" :props="{}" /></span>' },
        VBtn: {
          props: ["disabled"],
          template: '<button :disabled="disabled"><slot /></button>',
        },
        VIcon: true,
      },
    },
  });
  wrapper.pendingEvents = pendingEvents;
  wrappers.push(wrapper);
  return wrapper;
}
const apply = (wrapper) =>
  wrapper
    .findAll("button")
    .find((value) => value.text() === "应用修改")
    .trigger("click");
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => jest.clearAllMocks());
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

test("read-only chemical details show the structure first with collapsed SMILES and chemical roles", () => {
  const wrapper = setup({ editable: false });
  expect(wrapper.text()).toContain("目标化合物");
  expect(wrapper.getComponent({ name: "SmilesImage" }).props("smiles")).toBe(
    "CCO",
  );
  expect(wrapper.get("details").attributes("open")).toBeUndefined();
  expect(wrapper.get("summary").text()).toBe("SMILES");
  expect(wrapper.find("textarea").exists()).toBe(false);
  expect(wrapper.findComponent({ name: "StructureInput" }).exists()).toBe(
    false,
  );
  expect(setup({ editable: false, target: false }).text()).toContain(
    "中间体或原料",
  );
  expect(
    setup({
      editable: false,
      node: { ...node(), type: "reaction", smiles: "" },
    }).text(),
  ).toContain("反应步骤");
});

test("editable structures use the shared chemical input and preserve the captured node on apply", async () => {
  const wrapper = setup();
  await wrapper
    .get('textarea[aria-label="目标化合物结构"]')
    .setValue("OCCN.Cl");
  API.post.mockResolvedValue({ smiles: "[NH3+]CCO.[Cl-]" });
  await apply(wrapper);
  await flushPromises();
  expect(API.post).toHaveBeenCalledWith("/api/v1/structure/validate", {
    smiles: "OCCN.Cl",
  });
  expect(wrapper.emitted("update")[0][0]).toEqual({
    ...node(),
    smiles: "[NH3+]CCO.[Cl-]",
  });
});

test.each(["selection", "document", "read-only", "unmount"])(
  "late structural validation after %s cannot update a different context",
  async (transition) => {
    const wrapper = setup();
    const request = deferred();
    API.post.mockReturnValue(request.promise);
    await apply(wrapper);
    await apply(wrapper);
    expect(API.post).toHaveBeenCalledTimes(1);
    expect(wrapper.vm.pending).toBe(true);
    expect(wrapper.emitted("pending")).toEqual([[true]]);
    if (transition === "selection")
      await wrapper.setProps({ node: { ...node(), id: "other" } });
    if (transition === "document")
      await wrapper.setProps({ contextId: "document-b" });
    if (transition === "read-only") await wrapper.setProps({ editable: false });
    if (transition === "unmount") {
      wrapper.unmount();
      wrappers.splice(wrappers.indexOf(wrapper), 1);
    }
    request.resolve({ smiles: "O" });
    await flushPromises();
    expect(wrapper.emitted("update")).toBeUndefined();
    expect(wrapper.pendingEvents.mock.calls).toEqual([[true], [false]]);
  },
);

test("late errors for a former molecule do not appear in the new selection", async () => {
  const wrapper = setup();
  const request = deferred();
  API.post.mockReturnValue(request.promise);
  await apply(wrapper);
  await wrapper.setProps({ node: { ...node(), id: "other", smiles: "N" } });
  request.reject(new Error("old failure"));
  await flushPromises();
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  expect(
    wrapper.getComponent({ name: "StructureInput" }).props("modelValue"),
  ).toBe("N");
});

test("reaction annotations apply without inventing structures or model scores", async () => {
  const reaction = {
    ...node(),
    id: "r-1",
    type: "reaction",
    smiles: "",
    label: "反应步骤",
  };
  const wrapper = setup({ node: reaction, target: false });
  await wrapper.get("input").setValue("酰胺形成");
  await wrapper.get("textarea").setValue("手动记录");
  await apply(wrapper);
  expect(API.post).not.toHaveBeenCalled();
  expect(wrapper.emitted("update")[0][0]).toEqual({
    ...reaction,
    label: "酰胺形成",
    note: "手动记录",
  });
  expect(wrapper.text()).not.toContain("模型分数");
  expect(wrapper.findComponent({ name: "StructureInput" }).exists()).toBe(
    false,
  );
});

test("an invalid validation response preserves the draft instead of applying empty chemistry", async () => {
  const wrapper = setup();
  API.post.mockResolvedValue({ smiles: "" });
  await apply(wrapper);
  await flushPromises();
  expect(wrapper.emitted("update")).toBeUndefined();
  expect(wrapper.get('[role="alert"]').text()).toContain("有效结构");
  expect(wrapper.vm.pending).toBe(false);
  expect(wrapper.emitted("pending")).toEqual([[true], [false]]);
});

test("an old Apply response cannot unlock a new application after selection changes", async () => {
  const wrapper = setup();
  const first = deferred(),
    second = deferred();
  API.post
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  await apply(wrapper);
  await wrapper.setProps({ node: { ...node(), id: "other", smiles: "N" } });
  await apply(wrapper);
  first.resolve({ smiles: "O" });
  await flushPromises();
  expect(wrapper.vm.pending).toBe(true);
  expect(wrapper.emitted("update")).toBeUndefined();
  expect(wrapper.emitted("pending")).toEqual([[true], [false], [true]]);
  second.reject(new Error("validation failed"));
  await flushPromises();
  expect(wrapper.vm.pending).toBe(false);
  expect(wrapper.emitted("pending")).toEqual([
    [true],
    [false],
    [true],
    [false],
  ]);
  expect(wrapper.get('[role="alert"]').text()).toBeTruthy();
});

test("a late structure-input change cannot be overwritten by an older validation", async () => {
  const wrapper = setup();
  const request = deferred();
  API.post.mockReturnValue(request.promise);
  await apply(wrapper);
  wrapper
    .getComponent({ name: "StructureInput" })
    .vm.$emit("update:modelValue", "N");
  request.resolve({ smiles: "CCO" });
  await flushPromises();
  expect(wrapper.emitted("update")).toBeUndefined();
  expect(wrapper.get('[role="alert"]').text()).toContain("输入内容已变化");
  expect(
    wrapper.getComponent({ name: "StructureInput" }).props("modelValue"),
  ).toBe("N");
});

test("temporary read-only locks preserve unapplied edits without presenting them as applied data", async () => {
  const wrapper = setup();
  await wrapper.get('textarea[aria-label="目标化合物结构"]').setValue("N");
  await wrapper.get('textarea[maxlength="4096"]').setValue("尚未应用的备注");
  await wrapper.setProps({ editable: false });
  expect(wrapper.text()).not.toContain("尚未应用的备注");
  expect(wrapper.getComponent({ name: "SmilesImage" }).props("smiles")).toBe(
    "CCO",
  );
  await wrapper.setProps({ editable: true });
  expect(
    wrapper.getComponent({ name: "StructureInput" }).props("modelValue"),
  ).toBe("N");
  expect(wrapper.get('textarea[maxlength="4096"]').element.value).toBe(
    "尚未应用的备注",
  );
});

test("idle drafts report their current identity and explicit discard never applies chemistry", async () => {
  const wrapper = setup();
  await wrapper.get('textarea[maxlength="4096"]').setValue("unapplied note");
  const signal = wrapper.emitted("draft-change").at(-1)[0];
  expect(signal).toEqual(expect.objectContaining({ contextId: "document-a", nodeId: "target", dirty: true }));
  expect(wrapper.vm.pending).toBe(false);
  expect(wrapper.vm.draftDirty).toBe(true);
  await wrapper.setProps({ editable: false });
  expect(wrapper.vm.draftDirty).toBe(true);
  await wrapper.setProps({ editable: true });
  wrapper.vm.discardDraft();
  await flushPromises();
  expect(wrapper.get('textarea[maxlength="4096"]').element.value).toBe("");
  expect(wrapper.emitted("draft-change").at(-1)[0].dirty).toBe(false);
  expect(wrapper.emitted("update")).toBeUndefined();
  expect(API.post).not.toHaveBeenCalled();
});

test("display step numbers are UI-only and preserve the original reaction name", async () => {
  const reaction = { ...node(), id: "original-r", type: "reaction", smiles: "", label: "反应 9", note: "original note" };
  const wrapper = setup({ node: reaction, editable: false, displayStepNumber: 2 });
  expect(wrapper.get("header strong").text()).toBe("合成步骤 2");
  expect(wrapper.get(".inspector-readonly").text()).toBe("反应 9");
  await wrapper.setProps({ displayStepNumber: 0 });
  expect(wrapper.get("header strong").text()).toBe("反应步骤");
  expect(reaction.label).toBe("反应 9");
  expect(wrapper.emitted("update")).toBeUndefined();
});
