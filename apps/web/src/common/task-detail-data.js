import { readSelectedRoutes } from "./route-details";
import { errorMessage } from "./workspace-errors";

export async function loadTaskDetail(api, id) {
  const replies = await Promise.allSettled([
    api.get("/api/v1/unified-route/jobs/" + id, null, false),
    api.get("/api/results/retrieve", { result_id: id }),
  ]);
  const errors = [];
  let job,
    candidates = [];
  if (replies[0].status === "fulfilled") job = replies[0].value;
  else errors.push(errorMessage(replies[0].reason, "任务状态加载失败。"));
  if (replies[1].status === "fulfilled") {
    try {
      candidates = readSelectedRoutes(replies[1].value);
    } catch (cause) {
      errors.push(errorMessage(cause, "路线记录无效。"));
    }
  } else errors.push(errorMessage(replies[1].reason, "路线记录加载失败。"));
  return { job, candidates, error: errors.join(" ") };
}
