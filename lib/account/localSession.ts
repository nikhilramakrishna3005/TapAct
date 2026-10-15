/** Names of the Supabase SSR auth cookies, including chunked copies. */
export function supabaseAuthCookieNames(cookieHeader: string): string[] {
  return cookieHeader
    .split(";")
    .map((part) => part.trim().split("=")[0] ?? "")
    .filter((name) => /^sb-.+-auth-token(?:\.\d+)?$/.test(name));
}

export function expiredCookieAssignments(names: string[]): string[] {
  return names.map((name) => `${name}=; Max-Age=0; path=/`);
}
