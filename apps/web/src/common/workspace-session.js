// A failed read is not an authoritative denial; callers must not infer permission.
export async function readWorkspaceAccess({ fetcher = fetch, signal } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    if (controller.signal.aborted) return "unavailable";
    const response = await fetcher("/api/v1/session", {
      signal: controller.signal,
      credentials: "same-origin",
    });
    if (!response.ok) return [401, 403].includes(response.status) ? "denied" : "unavailable";
    const session = await response.json();
    if (controller.signal.aborted || !session || !["local", "askcos"].includes(session.mode)
      || typeof session.workspace_access !== "boolean") return "unavailable";
    return session.mode === "local" && session.workspace_access === true ? "allowed" : "denied";
  } catch {
    return "unavailable";
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

// API authentication recovery keeps its existing conservative boolean contract.
export async function hasWorkspaceAccess(fetcher = fetch) {
  return await readWorkspaceAccess({ fetcher }) === "allowed";
}
