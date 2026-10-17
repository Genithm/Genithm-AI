/** Product support policy only, never a substitute for auth or RLS.
 * Device hints can be absent or spoofed. Keep desktop resizing, zoom, touch
 * laptops, API automation and auth callbacks working; do not gate by width.
 */
export function isMobileResearchClient(headers: Pick<Headers, "get">): boolean {
  if (headers.get("sec-ch-ua-mobile") === "?1") return true;
  const platform = (headers.get("sec-ch-ua-platform") ?? "").replaceAll('"', "").toLowerCase();
  if (platform === "android" || platform === "ios") return true;
  const ua = (headers.get("user-agent") ?? "").slice(0, 2048);
  return /Android|iPhone|iPad|iPod|IEMobile|Windows Phone|webOS|BlackBerry|Opera Mini|Silk\//i.test(ua);
}

export function isDesktopWorkspacePath(path: string): boolean {
  return path === "/dashboard" || path.startsWith("/dashboard/") ||
    path === "/login" || path === "/signup" || path === "/preview";
}
