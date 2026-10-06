import { shallowMount } from "@vue/test-utils";
import SmilesImage from "./SmilesImage.vue";

jest.mock("@/composables/useTheme", () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock("vuetify/components/VImg", () => ({ VImg: { name: "VImg", template: "<div />" } }));

afterEach(() => jest.useRealTimers());

const mountImage = (props) => shallowMount(SmilesImage, {
  props,
  global: { stubs: { VSkeletonLoader: true, VIcon: true, VBtn: true } },
});

test("loading, error and retry preserve the real drawing URL", async () => {
  jest.useFakeTimers();
  const wrapper = mountImage({ smiles: "CCO", showErrorImage: false });
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
  const wrapper = mountImage({ smiles: "CCO" });
  wrapper.vm.startLoadTimer();
  jest.advanceTimersByTime(8000);
  await wrapper.vm.$nextTick();
  expect(wrapper.vm.renderFailed).toBe(true);
  wrapper.unmount();
});

test("a late cached loadstart cannot undo a completed image generation", async () => {
  jest.useFakeTimers();
  const wrapper = mountImage({ smiles: "CCO" });
  wrapper.vm.onImageLoad(true);
  wrapper.vm.startLoadTimer();
  jest.advanceTimersByTime(8000);
  expect(wrapper.vm.isLoading).toBe(false);
  expect(wrapper.vm.renderFailed).toBe(false);
  expect(jest.getTimerCount()).toBe(0);

  await wrapper.setProps({ smiles: "CCN" });
  expect(wrapper.vm.isLoading).toBe(true);
  wrapper.vm.startLoadTimer();
  jest.advanceTimersByTime(8000);
  expect(wrapper.vm.renderFailed).toBe(true);
  wrapper.vm.retryImage();
  expect(wrapper.vm.isLoading).toBe(true);
  wrapper.vm.startLoadTimer();
  wrapper.vm.onImageLoad(true);
  wrapper.vm.startLoadTimer();
  jest.advanceTimersByTime(8000);
  expect(wrapper.vm.renderFailed).toBe(false);
  expect(jest.getTimerCount()).toBe(0);
  wrapper.unmount();
});
test("offscreen lazy images do not time out before the browser starts loading", async () => {
  jest.useFakeTimers();
  const wrapper = mountImage({ smiles: "CCO" });
  jest.advanceTimersByTime(16000);
  expect(wrapper.vm.renderFailed).toBe(false);
  wrapper.vm.startLoadTimer();
  await wrapper.setProps({ smiles: "CCN" });
  jest.advanceTimersByTime(16000);
  expect(wrapper.vm.renderFailed).toBe(false);
  wrapper.vm.startLoadTimer();
  wrapper.vm.onImageLoad(true);
  jest.advanceTimersByTime(16000);
  expect(wrapper.vm.renderFailed).toBe(false);
  wrapper.unmount();
});

test("route canvas eager loading is forwarded while ordinary images remain lazy", () => {
  const ordinary = mountImage({ smiles: "CCO" });
  expect(ordinary.vm.imageProps.eager).toBeUndefined();
  ordinary.unmount();
  const route = shallowMount(SmilesImage, {
    props: { smiles: "CCO" },
    attrs: { eager: true },
    global: { stubs: { VSkeletonLoader: true, VIcon: true, VBtn: true } },
  });
  expect(route.vm.imageProps.eager).toBe(true);
  expect(route.vm.imageProps.src).toContain("/api/draw/?smiles=CCO");
  route.unmount();
});
