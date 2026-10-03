async function loadResultHistory(api, pageSize = 100) {
  const records = [];
  for (let offset = 0; offset < 10000; offset += pageSize) {
    const page = await api.get("/api/results/list", { limit: pageSize, offset });
    if (!Array.isArray(page)) throw new Error("历史结果格式无效");
    records.push(...page);
    if (page.length < pageSize) return records;
  }
  throw new Error("历史记录超过工作台批量上限，请按时间范围查询");
}

export { loadResultHistory };
