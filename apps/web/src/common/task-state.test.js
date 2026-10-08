import { activeTaskStates, displayTime, taskStateClass, taskStateLabel } from "./task-state";
import { setLocale } from "@/i18n";

test("localized task labels preserve the unchanged lifecycle values and classifications", () => {
  expect(activeTaskStates).toEqual(["queued", "preparing", "searching", "evaluating", "waiting_for_engine"]);
  expect(taskStateLabel("queued")).toBe("排队中");
  setLocale("en", { persist: false });
  expect(taskStateLabel("queued")).toBe("Queued");
  expect(taskStateLabel("completed_not_enough_routes")).toBe("Insufficient routes");
  expect(taskStateLabel("failed_unclosed")).toBe("Not closed");
  expect(taskStateClass("completed")).toBe("success");
  expect(taskStateClass("failed_unclosed")).toBe("error");
  expect(taskStateClass("queued")).toBe("");
  expect(taskStateLabel("unrecognized")).toBe("Unknown status");
});

test("invalid dates remain missing while valid dates follow the selected locale", () => {
  expect(displayTime("not a date")).toBe("—");
  const value = "2026-10-08T10:00:00Z";
  setLocale("en", { persist: false });
  expect(displayTime(value)).toBe(new Intl.DateTimeFormat("en", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(value)));
});
