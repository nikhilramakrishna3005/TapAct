import type { User } from "@supabase/supabase-js";

export type AccountSummary = {
  id: string;
  email: string | null;
  displayName: string | null;
  emailVerified: boolean;
};

export function summarizeUser(user: User): AccountSummary {
  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  const name = [metadata.display_name, metadata.full_name, metadata.name].find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  return {
    id: user.id,
    email: user.email ?? null,
    displayName: name ? name.trim().slice(0, 50) : null,
    emailVerified: Boolean(user.email_confirmed_at ?? user.confirmed_at),
  };
}

export function getInitials(account: Pick<AccountSummary, "displayName" | "email">): string {
  const source = account.displayName ?? account.email ?? "";
  const words = source.split(/[\s@._-]+/).filter(Boolean);
  if (words.length === 0) {
    return "?";
  }
  const initials = account.displayName && words.length > 1 ? words[0][0] + words[words.length - 1][0] : words[0][0];
  return initials.toUpperCase();
}
