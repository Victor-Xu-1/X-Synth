import { isJobActive, isJobTerminal, jobStateLabel } from "./job-state";

test.each(["queued", "preparing", "searching", "evaluating"])("polls active product state %s", (status) => {
  expect(isJobActive(status)).toBe(true);
  expect(isJobTerminal(status)).toBe(false);
});

test.each(["completed", "completed_not_enough_routes", "failed_unclosed", "failed", "cancelled"])("stops polling final state %s", (status) => {
  expect(isJobTerminal(status)).toBe(true);
  expect(isJobActive(status)).toBe(false);
});

test("waiting preserves an explicit recoverable state", () => {
  expect(isJobActive("waiting_for_engine")).toBe(false);
  expect(isJobTerminal("waiting_for_engine")).toBe(false);
  expect(jobStateLabel("waiting_for_engine")).toBe("等待服务恢复");
});
