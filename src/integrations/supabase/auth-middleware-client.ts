// Project-specific client-side function middleware that attaches the Supabase
// bearer token to every server-function RPC. Reads the token directly from the
// browser's localStorage (Supabase's persisted session), with a fallback to
// supabase.auth.getSession(). This avoids race conditions where getSession()
// returns null on first mount before the client has finished hydrating.
import { createMiddleware } from "@tanstack/react-start";
import { supabase } from "./client";

function readTokenFromStorage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (!key.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as { access_token?: string };
      const token = parsed?.access_token;
      if (token) return token;

    }
  } catch {
    // ignore
  }
  return null;
}

export const attachSupabaseAuth = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    let token = readTokenFromStorage();
    if (!token) {
      try {
        const { data } = await supabase.auth.getSession();
        token = data.session?.access_token ?? null;
      } catch {
        // ignore — request goes without auth header
      }
    }
    return next({
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  },
);
