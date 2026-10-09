import { captureKetcherRecoveryFocus } from "./ketcher-recovery-focus";

test("only current keyboard recovery returns focus, never pointer recovery or displaced intent", () => {
  const trigger = document.createElement("button"); document.body.append(trigger); trigger.focus();
  const restore = jest.fn();
  const finish = captureKetcherRecoveryFocus({ currentTarget: trigger, detail: 0 }, () => true, restore);
  trigger.remove(); finish();
  expect(restore).toHaveBeenCalledTimes(1);
  document.body.append(trigger); trigger.focus();
  const displaced = captureKetcherRecoveryFocus({ currentTarget: trigger, detail: 0 }, () => true, restore);
  document.dispatchEvent(new Event("pointerdown")); displaced();
  const editing = captureKetcherRecoveryFocus({ currentTarget: trigger, detail: 0 }, () => true, restore);
  document.dispatchEvent(new Event("input")); editing();
  const stale = captureKetcherRecoveryFocus({ currentTarget: trigger, detail: 0 }, () => false, restore);
  stale();
  captureKetcherRecoveryFocus({ currentTarget: trigger, detail: 1 }, () => true, restore)();
  expect(restore).toHaveBeenCalledTimes(1);
  trigger.remove();
});
