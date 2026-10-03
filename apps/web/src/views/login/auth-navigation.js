const authPaths = new Set([
  "/login",
  "/admin-login",
  "/sso-login",
  "/sso-callback",
  "/sso-logout",
]);

export function safeAccountRedirect(value, fallback = "/") {
  if (typeof value !== "string") return fallback;
  try {
    const path = decodeURIComponent(value);
    if (
      !path.startsWith("/") ||
      path.startsWith("//") ||
      path.includes("\\") ||
      Array.from(path).some((char) => char.charCodeAt(0) <= 32)
    )
      return fallback;
    const pathname = new URL(
      path,
      "https://workspace.invalid",
    ).pathname.replace(/\/$/, "");
    return authPaths.has(pathname) ? fallback : path;
  } catch {
    return fallback;
  }
}
