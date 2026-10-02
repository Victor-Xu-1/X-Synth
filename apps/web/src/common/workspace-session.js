// Product workspace access is separate from native account administration.
export async function hasWorkspaceAccess(fetcher = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetcher("/api/v1/session", {
      signal: controller.signal,
      credentials: "same-origin",
    });
    if (!response.ok) return false;
    const session = await response.json();
    return session.mode === "local" && session.workspace_access === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
