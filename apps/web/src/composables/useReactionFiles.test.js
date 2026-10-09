import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, ref } from "vue";
import { API } from "@/common/api";
import { useReactionFiles } from "./useReactionFiles";
import { TextDecoder, TextEncoder } from "node:util";

globalThis.TextDecoder ||= TextDecoder;

jest.mock("@/common/api", () => ({ API: { post: jest.fn() } }));
const wrappers = [];
function setup() {
  const text = ref(""), disabled = ref(false);
  let state;
  const wrapper = mount(defineComponent({ setup() {
    state = useReactionFiles({ text, disabled: () => disabled.value, board: ref(null), draft: { selected: ref("") } });
    return () => null;
  } }));
  wrappers.push(wrapper);
  return { state, text, disabled, wrapper };
}
const event = () => {
  const bytes = new TextEncoder().encode("$RXN\ntransport fixture");
  return { target: { value: "file", files: [{ name: "ownership.rxn", size: bytes.byteLength, arrayBuffer: async () => bytes.buffer }] } };
};
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); API.post.mockReset(); });

test("RXN staging forwards a bounded owned request and explicit discard releases it", async () => {
  API.post.mockImplementation((_, body, query, options) => new Promise((resolve, reject) =>
    options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true })));
  const { state } = setup(), operation = state.importFile(event()); await flushPromises();
  const options = API.post.mock.calls[0][3];
  expect(options.timeoutMs).toBe(15000); expect(state.fileBusy.value).toBe(true);
  state.discardFile(); expect(options.signal.aborted).toBe(true);
  expect(await operation).toBe(false); expect(state.fileBusy.value).toBe(false);
  expect(state.fileDraft.value).toBeNull(); expect(state.fileError.value).toBe("");
});

test.each(["input", "disabled", "unmount"])("%s change cancels staging; late malformed data cannot publish", async kind => {
  let resolve;
  API.post.mockImplementation(() => new Promise(done => { resolve = done; }));
  const { state, text, disabled, wrapper } = setup(), operation = state.importFile(event()); await flushPromises();
  const options = API.post.mock.calls[0][3];
  if (kind === "input") text.value = "CCN";
  else if (kind === "disabled") disabled.value = true;
  else wrapper.unmount();
  expect(options.signal.aborted).toBe(true);
  resolve({ malformedTransport: true }); expect(await operation).toBe(false);
  expect(state.fileDraft.value).toBeNull(); expect(state.fileBusy.value).toBe(false);
  expect(state.fileError.value).toBe("");
});

test("a failed parser request releases file controls so the same file can be retried", async () => {
  API.post.mockRejectedValue(new DOMException("service timeout", "TimeoutError"));
  const { state, text } = setup();
  expect(await state.importFile(event())).toBe(false); expect(state.fileBusy.value).toBe(false);
  expect(state.fileDraft.value).toBeNull(); expect(state.fileError.value).toBe("服务请求超时，请刷新或重试。"); expect(text.value).toBe("");
  expect(await state.importFile(event())).toBe(false); expect(API.post).toHaveBeenCalledTimes(2);
});
