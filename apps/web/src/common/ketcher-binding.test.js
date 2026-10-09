import { createKetcherBinding } from "./ketcher-binding";

function native() {
  return { editor: { subscribe: jest.fn(() => ({ handler: jest.fn() })), unsubscribe: jest.fn() } };
}

test("rebinding releases one old subscription and subscribes once to the current native instance", () => {
  const binding = createKetcherBinding(() => true, jest.fn());
  const first = native(), next = native();
  binding.bind(first); binding.bind(first);
  expect(first.editor.subscribe).toHaveBeenCalledTimes(1);
  binding.bind(next);
  expect(first.editor.unsubscribe).toHaveBeenCalledTimes(1);
  expect(binding.current).toBe(next);
  binding.release(); binding.release();
  expect(next.editor.unsubscribe).toHaveBeenCalledTimes(1);
  binding.bind(next);
  expect(next.editor.subscribe).toHaveBeenCalledTimes(2);
});

test("a failed binding cannot make a second attempt skip native subscription validation", () => {
  const binding = createKetcherBinding(() => true, jest.fn());
  const invalid = { editor: {} };
  expect(() => binding.bind(invalid)).toThrow("unavailable");
  expect(() => binding.bind(invalid)).toThrow("unavailable");
  expect(binding.current).toBeUndefined();
  const fresh = native();
  binding.bind(fresh);
  expect(binding.current).toBe(fresh);
});
