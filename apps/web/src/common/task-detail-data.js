import { readSelectedRoutes } from "./route-details";
import { errorMessage } from "./workspace-errors";
import { taskDeliveryReview } from "./delivery-review";
import { deliveryReviewMatchesTask, readDeliveryReviewAggregate } from "./delivery-review-aggregate";

const SHA256 = /^[a-f0-9]{64}$/;

export function taskArtifactIdentity(job) {
  if (job.result_snapshot != null) {
    if (typeof job.result_snapshot !== "string" || job.result_snapshot.length !== 64 || !SHA256.test(job.result_snapshot))
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
    artifactReview = null,
    artifactError = "";

  function reset() {
    generation++;
    identifier = "";
    candidates = [];
    loaded = false;
    artifactIdentity = undefined;
    artifactReview = null;
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
        if (job.job_id !== undefined && job.job_id !== id || job.result_id !== undefined && job.result_id !== id)
          throw new Error(JSON.stringify({ detail: "任务结果绑定不一致。" }));
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
        const receipt = response?.result?.unified_route_pool?.summary?.delivery_review;
        const aggregate = readDeliveryReviewAggregate(receipt);
        const currentSummary = receipt !== undefined && receipt?.basis !== "stored_summary";
        if (currentSummary) failureMessage = "路线审查汇总与当前结果不一致。";
        if (currentSummary && (!aggregate || aggregate.status !== "ready" ||
            aggregate.source_binding.job_id !== id || !deliveryReviewMatchesTask(aggregate, job) ||
            aggregate.route_count !== routes.length || identity === "unpublished" && routes.length > 0))
          throw new Error("路线审查汇总与当前结果不一致。");
        if (identity?.startsWith("snapshot:") || aggregate) {
          failureMessage = "结果发布快照校验失败。";
          const confirmed = await api.get("/api/v1/unified-route/jobs/" + id, null, false, {
            signal, timeoutMs: 15000,
          });
          if (!isCurrent()) return null;
          job = confirmed;
          if (taskArtifactIdentity(confirmed) !== identity ||
              aggregate && !deliveryReviewMatchesTask(aggregate, confirmed))
            throw new Error(JSON.stringify({ detail: "结果发布版本已变化，请刷新详情。" }));
        }
        candidates = routes;
        loaded = true;
        artifactIdentity = identity;
        // Keep the confirmed review with its route generation, independent of index progress.
        artifactReview = aggregate ? {
          ...aggregate, grade_counts: { ...aggregate.grade_counts }, source_binding: { ...aggregate.source_binding },
        } : null;
        artifactError = "";
        artifactRefreshed = true;
      } catch (cause) {
        if (!isCurrent()) return null;
        artifactError = errorMessage(cause, failureMessage);
      }
    }
    if (artifactError) errors.push(artifactError);
    const artifactCurrent = !!job && validIdentity && loaded && identity === artifactIdentity && !artifactError;
    const deliveryReview = errors.length ? null
      : artifactCurrent && artifactReview && deliveryReviewMatchesTask(artifactReview, job)
        ? artifactReview : taskDeliveryReview(job);
    return {
      job, candidates, error: errors.join(" "), artifactRefreshed,
      artifactCurrent, deliveryReview,
    };
  }
  return { load, reset };
}
