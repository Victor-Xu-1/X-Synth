import { unifiedRouteStatusEndpoint } from "./unified-route";

export async function readTaskParameters(api, id, { signal } = {}) {
  const response = await api.get(unifiedRouteStatusEndpoint(id), { include_settings: true }, true,
    { signal, timeoutMs: 15000 });
  const settings = response?.settings;
  if (response?.job_id !== id || response.result_id !== undefined && response.result_id !== id
    || !settings || typeof settings !== "object" || Array.isArray(settings)
    || typeof settings.smiles !== "string" || !settings.smiles.trim() || settings.smiles !== response.target_smiles)
    throw new Error(JSON.stringify({ detail: "原始搜索参数响应无效，未预填任务。" }));
  return response;
}
