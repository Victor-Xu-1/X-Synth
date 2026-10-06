import { readSelectedRoutes } from "./route-details";
import { errorMessage } from "./workspace-errors";

const SHA256 = /^[a-f0-9]{64}$/;

export function taskArtifactIdentity(job) {
  if (job.result_snapshot != null) {
    if (typeof job.result_snapshot !== "string" || !SHA256.test(job.result_snapshot))
      throw new Error("任务结果快照标识无效。");
    return `snapshot:${job.result_snapshot}`;
  }
  if (job.progress?.result_artifact_schema === 1 && !job.status?.startsWith("legacy_")) {
    if (job.result_snapshot !== null)
      throw new Error("任务未返回结果发布标识。");
    return "unpublished";
  }
  // Worker revisions and elapsed/native counters change without publishing routes.
  return JSON.stringify([
    job.status,
    job.progress?.pass_number ?? null,
    job.summary?.selected_route_count ?? job.selected_route_count ?? null,
  ]);
}

export function createTaskDetailLoader(api) {
  let generation = 0,
    identifier = "",
    candidates = [],
    loaded = false,
    artifactIdentity,
    artifactError = "";

  function reset() {
    generation++;
    identifier = "";
    candidates = [];
    loaded = false;
    artifactIdentity = undefined;
    artifactError = "";
  }

  async function load(id, { force = false, signal } = {}) {
    if (identifier !== id) {
      reset();
      identifier = id;
    }
    const current = ++generation;
    const isCurrent = () => current === generation && !signal?.aborted;
    const errors = [];
    let job, identity;
    let validIdentity = true;
    let artifactRefreshed = false;
    try {
      job = await api.get("/api/v1/unified-route/jobs/" + id, null, false, {
        signal,
        timeoutMs: 15000,
      });
    } catch (cause) {
      errors.push(errorMessage(cause, "任务状态加载失败。"));
    }
    if (job) {
      try {
        identity = taskArtifactIdentity(job);
      } catch (cause) {
        validIdentity = false;
        errors.push(errorMessage(cause, "任务结果快照标识无效。"));
      }
    }
    if (!isCurrent()) return null;
    if (identity === "unpublished" && !force) {
      if (loaded && artifactIdentity !== identity && candidates.length) {
        artifactError = "任务未返回已发布结果快照，保留先前读取的路线。";
      } else {
        loaded = true;
        artifactIdentity = identity;
        artifactError = "";
      }
    } else if (
      validIdentity &&
      (force || !loaded || (job && identity !== artifactIdentity) || artifactError)
    ) {
      let failureMessage = "路线记录加载失败。";
      try {
        const response = await api.get(
          "/api/results/retrieve", { result_id: id }, true,
          { signal, timeoutMs: 15000 },
        );
        if (!isCurrent()) return null;
        failureMessage = "路线记录无效。";
        if (identity?.startsWith("snapshot:") && !Array.isArray(response?.result?.unified_route_pool?.selected_routes))
          throw new Error("已发布结果未返回路线列表。");
        const routes = readSelectedRoutes(response);
        if (identity?.startsWith("snapshot:")) {
          failureMessage = "结果发布快照校验失败。";
          const confirmed = await api.get("/api/v1/unified-route/jobs/" + id, null, false, {
            signal, timeoutMs: 15000,
          });
          if (!isCurrent()) return null;
          job = confirmed;
          if (taskArtifactIdentity(confirmed) !== identity)
            throw new Error(JSON.stringify({ detail: "结果发布版本已变化，请刷新详情。" }));
        }
        candidates = routes;
        loaded = true;
        artifactIdentity = identity;
        artifactError = "";
        artifactRefreshed = true;
      } catch (cause) {
        if (!isCurrent()) return null;
        artifactError = errorMessage(cause, failureMessage);
      }
    }
    if (artifactError) errors.push(artifactError);
    return {
      job, candidates, error: errors.join(" "), artifactRefreshed,
      artifactCurrent: !!job && validIdentity && loaded && identity === artifactIdentity && !artifactError,
    };
  }
  return { load, reset };
}
