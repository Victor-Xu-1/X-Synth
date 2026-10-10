import { createKetcherZoomBinding } from "./ketcher-zoom-binding";

function nativeZoom(value) {
  const callbacks = new Set();
  const editor = {
    zoom: jest.fn(() => value),
    subscribe: jest.fn((_name, callback) => { callbacks.add(callback); return { handler: callback }; }),
    unsubscribe: jest.fn((_name, token) => callbacks.delete(token.handler)),
  };
  return { editor, callbacks, changed(next, selection) {
    value = next;
    for (const callback of callbacks) selection = callback(selection);
    return selection;
  } };
}

test("native zoom changes publish their real value, without structural reads or another timer", () => {
  const source = nativeZoom(.292554), publish = jest.fn(), binding = createKetcherZoomBinding(publish);
  binding.bind(source.editor);
  expect(publish).toHaveBeenLastCalledWith(.292554);
  source.changed(1.25);
  expect(publish).toHaveBeenLastCalledWith(1.25);
  expect(source.editor.subscribe).toHaveBeenCalledWith("selectionChange", expect.any(Function));
  binding.release();
});

test("rebinding the same editor is deduplicated, replacement removes only its exact subscription", () => {
  const first = nativeZoom(1), second = nativeZoom(.5), publish = jest.fn();
  const binding = createKetcherZoomBinding(publish);
  binding.bind(first.editor); binding.bind(first.editor);
  expect(first.editor.subscribe).toHaveBeenCalledTimes(1);
  const callback = first.editor.subscribe.mock.calls[0][1];
  binding.bind(second.editor);
  expect(first.editor.unsubscribe).toHaveBeenCalledWith("selectionChange", { handler: callback });
  expect(first.callbacks.size).toBe(0);
  publish.mockClear(); callback(); expect(publish).not.toHaveBeenCalled();
  second.changed(2); expect(publish).toHaveBeenLastCalledWith(2);
  binding.release(); expect(second.callbacks.size).toBe(0);
  expect(publish).toHaveBeenLastCalledWith(null);
});

test("repeated release is safe and a released dispatch cannot publish late state", () => {
  const source = nativeZoom(1), publish = jest.fn(), binding = createKetcherZoomBinding(publish);
  binding.bind(source.editor);
  const callback = source.editor.subscribe.mock.calls[0][1];
  binding.release(); binding.release(); publish.mockClear(); callback();
  expect(publish).not.toHaveBeenCalled();
  expect(source.editor.unsubscribe).toHaveBeenCalledTimes(1);
});

test("the native functional event passes the original selection through to following peers", () => {
  const source = nativeZoom(1), publish = jest.fn(), binding = createKetcherZoomBinding(publish);
  binding.bind(source.editor);
  const selected = { atoms: [7], bonds: [] }, following = jest.fn(value => value);
  source.editor.subscribe("selectionChange", following);
  expect(source.changed(.75, selected)).toBe(selected);
  expect(following).toHaveBeenCalledWith(selected);
  const observed = source.editor.subscribe.mock.calls[0][1];
  binding.release();
  expect(observed(selected)).toBe(selected);
});

test.each([NaN, Infinity, 0, -1])("invalid native zoom %s is unavailable, never reported as 100%%", value => {
  const source = nativeZoom(value), publish = jest.fn(), binding = createKetcherZoomBinding(publish);
  binding.bind(source.editor); expect(publish).toHaveBeenLastCalledWith(null); binding.release();
});

test("an unsupported native event surface is rejected before replacing the current owner", () => {
  const source = nativeZoom(1), publish = jest.fn(), binding = createKetcherZoomBinding(publish);
  binding.bind(source.editor);
  expect(() => binding.bind({ zoom: () => .5 })).toThrow("zoom events");
  expect(source.callbacks.size).toBe(1); binding.release();
});
