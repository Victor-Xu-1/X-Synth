export function elapsedLabel(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "未记录";
  const whole = Math.floor(seconds);
  return whole < 60 ? `${whole} 秒` : `${Math.floor(whole / 60)} 分 ${whole % 60} 秒`;
}

export function searchProgressRows(progress) {
  const labels = { mcts: "树搜索", retro_star: "启发式搜索" };
  return Object.entries(progress?.native_progress || {}).map(([key, value]) => ({
    key,
    label: labels[key] || key,
    iterations: Number.isInteger(value.iterations) ? value.iterations : null,
    chemicals: Number.isInteger(value.chemicals) ? value.chemicals : null,
    elapsed: elapsedLabel(value.elapsed_seconds),
  }));
}
