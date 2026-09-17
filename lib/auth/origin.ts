import "server-only";

export function isSameOrigin(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    // Host is preserved by the reverse proxy; do not trust arbitrary forwarded hosts.
    const expectedHost = request.headers.get("host") ?? new URL(request.url).host;
    const parsed = new URL(origin);
    return ["http:", "https:"].includes(parsed.protocol) && parsed.host === expectedHost &&
      parsed.protocol === (process.env.NODE_ENV === "production" && process.env.AUTH_COOKIE_SECURE !== "false" ? "https:" : new URL(request.url).protocol);
  } catch { return false; }
}
