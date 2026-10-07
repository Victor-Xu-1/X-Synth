import { flushPromises, mount } from "@vue/test-utils";
import CopyTooltip from "./CopyTooltip.vue";
import { copyToClipboard } from "@/common/utils";

jest.mock("@/common/utils", () => ({ copyToClipboard: jest.fn() }));
const wrappers = [];
function setup(data = "CCO") {
  const wrapper = mount(CopyTooltip, {
    props: { data, title: "复制 SMILES" },
    slots: { default: '<span>结构</span><button type="button">重试</button>' },
    global: { stubs: { VTooltip: { template: '<span class="hint"><slot /></span>' } } },
  });
  wrappers.push(wrapper);
  return wrapper;
}
beforeEach(() => { jest.useFakeTimers(); copyToClipboard.mockReset().mockResolvedValue(true); });
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); jest.useRealTimers(); });

test("copy has a named keyboard entry and activates once for Enter or Space", async () => {
  const wrapper = setup();
  expect(wrapper.attributes("tabindex")).toBe("0");
  expect(wrapper.attributes("aria-label")).toBe("复制 SMILES");
  await wrapper.trigger("keydown", { key: "Enter" });
  await flushPromises();
  expect(copyToClipboard).toHaveBeenLastCalledWith("CCO", wrapper.element);
  await wrapper.trigger("keydown", { key: " ", repeat: true });
  expect(copyToClipboard).toHaveBeenCalledTimes(1);
  await wrapper.trigger("keydown", { key: " " });
  await flushPromises();
  expect(copyToClipboard).toHaveBeenCalledTimes(2);
});
test("an unsuccessful copy never announces success", async () => {
  copyToClipboard.mockResolvedValue(false);
  const wrapper = setup();
  await wrapper.trigger("click");
  await flushPromises();
  expect(wrapper.get(".hint").text()).toContain("复制未完成");
  expect(wrapper.text()).not.toContain("已复制");
});
test("nested controls and empty data do not copy", async () => {
  const wrapper = setup();
  await wrapper.get("button").trigger("click");
  await wrapper.get("button").trigger("keydown", { key: "Enter" });
  expect(copyToClipboard).not.toHaveBeenCalled();
  await wrapper.setProps({ data: "" });
  await wrapper.trigger("click");
  expect(wrapper.attributes("aria-disabled")).toBe("true");
  expect(copyToClipboard).not.toHaveBeenCalled();
});
test("changing the value invalidates late feedback and pending writes remain single-flight", async () => {
  let resolve;
  copyToClipboard.mockReturnValue(new Promise(done => { resolve = done; }));
  const wrapper = setup();
  await wrapper.trigger("click");
  await wrapper.trigger("click");
  expect(copyToClipboard).toHaveBeenCalledTimes(1);
  await wrapper.setProps({ data: "N" });
  resolve(true);
  await flushPromises();
  expect(wrapper.text()).not.toContain("已复制");
  expect(wrapper.attributes("aria-busy")).toBe("false");
});
