import { shallowMount } from "@vue/test-utils";
import SmilesImage from "./SmilesImage.vue";

jest.mock("@/composables/useTheme", () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock("vuetify/components/VImg", () => ({ VImg: { name: "VImg", template: "<div />" } }));

afterEach(() => jest.useRealTimers());

test("loading, error and retry preserve the real drawing URL", async () => {
  jest.useFakeTimers();
  const wrapper = shallowMount(SmilesImage, { props: { smiles: "CCO", showErrorImage: false } });
  expect(wrapper.vm.url).toContain("/api/draw/?smiles=CCO");
  expect(wrapper.vm.isLoading).toBe(true);
  wrapper.vm.onImageLoad(false);
  await wrapper.vm.$nextTick();
  expect(wrapper.text()).toContain("结构加载失败");
  wrapper.vm.retryImage();
  await wrapper.vm.$nextTick();
  expect(wrapper.vm.renderAttempt).toBe(1);
  expect(wrapper.vm.renderFailed).toBe(false);
  wrapper.vm.onImageLoad(true);
  expect(wrapper.vm.isLoading).toBe(false);
  expect(wrapper.emitted("load")).toHaveLength(1);
  wrapper.unmount();
  expect(jest.getTimerCount()).toBe(0);
});

test("a timed-out image has a recoverable error state, not a blank success", async () => {
  jest.useFakeTimers();
  const wrapper = shallowMount(SmilesImage, { props: { smiles: "CCO" } });
  jest.advanceTimersByTime(8000);
  await wrapper.vm.$nextTick();
  expect(wrapper.vm.renderFailed).toBe(true);
  wrapper.unmount();
});
