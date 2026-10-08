import { createPinia, setActivePinia } from "pinia";
import { API } from "@/common/api";
import { createSubmissionAttempts } from "./submission-attempt";
import { createScreenSubmission, createSolubilitySubmission, runSolubilitySubmission } from "./submission";

const originalFetch = global.fetch;
const reply = (value) => ({ ok: true, status: 200, json: async () => value });
const flush = async () => { for (let index = 0; index < 24; index++) await Promise.resolve(); };

beforeEach(() => {
  jest.useFakeTimers();
  setActivePinia(createPinia());
  localStorage.clear();
  global.fetch = jest.fn();
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  global.fetch = originalFetch;
});

// Real shared transport with isolated HTTP protocol fixtures; no live model/API operations.
test.each(["submission", "poll"])("retiring an attempt aborts stalled %s HTTP and leaves no poll timers or remote cancel", async (stage) => {
  let complete;
  const stalled = new Promise((resolve) => { complete = resolve; });
  if (stage === "submission") global.fetch.mockReturnValue(stalled);
  else global.fetch.mockResolvedValueOnce(reply({ task_id: "protocol-task" })).mockReturnValue(stalled);
  const lifetime = new AbortController(), attempts = createSubmissionAttempts(lifetime.signal), attempt = attempts.begin();
  const submission = createSolubilitySubmission("solprop", [{ solute: "[13CH4]", solvent: "O", temp: 298, density: 0.8 }]);
  const pending = runSolubilitySubmission(submission, attempt.signal, API.runCeleryTask.bind(API));
  const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await flush();
  expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual(submission.body);
  const signals = global.fetch.mock.calls.map((call) => call[1].signal);
  attempts.retire(attempt);
  await rejected;
  expect(signals.at(-1).aborted).toBe(true);
  complete(reply(stage === "submission" ? { task_id: "late-task" } : { complete: true, output: [{}] }));
  await flush(); await jest.advanceTimersByTimeAsync(API.pollIntervalLong * 2);
  expect(global.fetch.mock.calls.map(([url]) => url)).toEqual(stage === "submission"
    ? [submission.endpoint] : [submission.endpoint, "/api/legacy/celery/task/protocol-task/"]);
  expect(jest.getTimerCount()).toBe(0);
});

test("a sibling native-task failure retires the shared attempt and cancels the other scheduled poll", async () => {
  const lifetime = new AbortController(), attempts = createSubmissionAttempts(lifetime.signal), attempt = attempts.begin();
  const submission = createScreenSubmission({ solute: "CCO" }, ["O"], [298, 323]);
  global.fetch.mockImplementation((url, options) => {
    if (options.method === "POST") return Promise.resolve(reply({ task_id: `protocol-${JSON.parse(options.body).task_list[0].temp}` }));
    return Promise.resolve(reply(url.includes("protocol-298")
      ? { failed: true, output: { string_error: "isolated task failure" } }
      : { complete: false }));
  });
  const pending = Promise.all(submission.requests.map((request) =>
    runSolubilitySubmission(request, attempt.signal, API.runCeleryTask.bind(API))));
  const rejected = expect(pending).rejects.toThrow("isolated task failure");
  await flush(); await rejected;
  const reads = global.fetch.mock.calls.length;
  attempts.retire(attempt);
  await flush(); await jest.advanceTimersByTimeAsync(API.pollIntervalLong * 2);
  expect(global.fetch).toHaveBeenCalledTimes(reads);
  expect(global.fetch.mock.calls.filter((call) => call[1].method === "POST")).toHaveLength(2);
  expect(global.fetch.mock.calls.every(([url]) => !url.includes("cancel"))).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
});
