import { mount } from "@vue/test-utils";
import MoleculeNode from "./MoleculeNode.vue";
import ReactionNode from "./ReactionNode.vue";

jest.mock("@vue-flow/core", () => ({
  Handle: { template: "<span />" }, Position: { Left: "left", Right: "right" },
}));
jest.mock("@/components/SmilesImage.vue", () => ({
  name: "SmilesImage", props: ["smiles", "width", "height", "eager", "showErrorImage"], template: "<div />",
}));
const stubs = {
  VIcon: true,
  VBtn: { template: "<button />" },
  VTooltip: { template: '<div><slot name="activator" :props="{}" /></div>' },
};
const wrappers = [];
const setup = (component, data) => {
  const wrapper = mount(component, { props: { data }, global: { stubs } });
  wrappers.push(wrapper);
  return wrapper;
};
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

test.each([[0, "0.00"], [0.625, "0.63"]])("finite step score %s retains its neutral label and precision", (score, text) => {
  const wrapper = setup(ReactionNode, { score, label: "步骤 1", reading: true });
  expect(wrapper.get("small").text()).toBe(`步骤分数 ${text}`);
  expect(wrapper.get("strong").attributes("title")).toBe("步骤 1");
});

test.each([undefined, null, NaN, Infinity, -Infinity])("invalid or missing step score %s does not manufacture a displayed score", (score) => {
  expect(setup(ReactionNode, { score }).find("small").exists()).toBe(false);
});

test("molecule identity, dimensions and image failure policy do not change with node styling", () => {
  const smiles = "[13CH3][C@H]([NH3+])CO.[Cl-]";
  const wrapper = setup(MoleculeNode, {
    smiles, isTarget: true, isStarting: true, label: "完整目标名称",
    imageWidth: 200, imageHeight: 144, overview: false,
  });
  expect(wrapper.classes()).toContain("target");
  expect(wrapper.classes()).not.toContain("starting");
  expect(wrapper.get(".graph-node-heading").text()).toContain("目标分子");
  expect(wrapper.getComponent({ name: "SmilesImage" }).props()).toMatchObject({
    smiles, width: 200, height: 144, eager: true, showErrorImage: false,
  });
  expect(wrapper.get(".graph-node-smiles").attributes("title")).toBe(smiles);
});
