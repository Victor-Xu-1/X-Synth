import { readTaskParameters } from "./task-parameters";

const settings = { smiles: "[Na+].CC(=O)[O-]", description: "Raw user name / %", expansion_time: 127, tuning: { minimum_plausibility: 0 } };
const data = { job_id: "task-a", target_smiles: settings.smiles, settings };
test("parameter reads are owned, bounded and independent of route artifacts", async () => {
  const signal = new AbortController().signal, api = { get: jest.fn().mockResolvedValue(data) };
  expect(await readTaskParameters(api, "task-a", { signal })).toBe(data);
  expect(api.get).toHaveBeenCalledWith("/api/v1/unified-route/jobs/task-a", { include_settings: true }, true, { signal, timeoutMs: 15000 });
  expect(data.settings).toEqual(settings);
});
test.each([
  { ...data, job_id: "task-b" }, { ...data, settings: null },
  { ...data, result_id: "task-b" },
  { ...data, settings: {} }, { ...data, settings: { ...settings, smiles: "CCN" } },
])("invalid or mismatched parameter snapshots cannot become a replay", async value => {
  await expect(readTaskParameters({ get: async () => value }, "task-a")).rejects.toThrow();
});
