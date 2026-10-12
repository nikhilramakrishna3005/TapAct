import type { EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { RESET_PASSWORD_PATH, safeNextPath } from "@/lib/auth/redirect";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const OTP_TYPES: EmailOtpType[] = ["signup", "email", "recovery", "invite", "magiclink", "email_change"];

function redirectTo(request: NextRequest, path: string) {
  const response = NextResponse.redirect(new URL(path, request.nextUrl.origin));
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function authErrorPath(error: string, mode: "sign-in" | "forgot") {
  return `/auth?mode=${mode}&error=${error}`;
}

/**
 * Landing point for every Supabase email link (sign-up confirmation and password
 * recovery). Supports the token-hash template, which works even when the link is
 * opened in another browser, and the default PKCE `code` link.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get("token_hash");
  const rawType = params.get("type");
  const code = params.get("code");
  const type = OTP_TYPES.find((candidate) => candidate === rawType) ?? null;
  const isRecovery = type === "recovery" || safeNextPath(params.get("next")) === RESET_PASSWORD_PATH;
  const next = isRecovery ? RESET_PASSWORD_PATH : safeNextPath(params.get("next"));
  const failureMode = isRecovery ? "forgot" : "sign-in";

  if (params.get("error_code") || params.get("error")) {
    return redirectTo(request, authErrorPath("link_expired", failureMode));
  }

  const supabase = await getSupabaseServerClient();
  if (!supabase) {
    return redirectTo(request, authErrorPath("unavailable", "sign-in"));
  }

  try {
    if (tokenHash && type) {
      const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
      if (error) {
        return redirectTo(request, authErrorPath("link_expired", failureMode));
      }
      return redirectTo(request, next);
    }
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        // The PKCE verifier lives in the browser that started the flow. Sign-up links
        // still confirm the address before redirecting here, so ask the user to sign in.
        return redirectTo(request, authErrorPath(isRecovery ? "link_expired" : "link_other_browser", failureMode));
      }
      return redirectTo(request, next);
    }
  } catch {
    return redirectTo(request, authErrorPath("unavailable", "sign-in"));
  }

  return redirectTo(request, authErrorPath("link_invalid", failureMode));
}
