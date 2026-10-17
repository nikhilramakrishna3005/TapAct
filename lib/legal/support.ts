/**
 * Public support contact. Set NEXT_PUBLIC_SUPPORT_EMAIL to an address you
 * actually read before launch. Placeholder domains are treated as unpublished
 * so a sample address can never be shown as a real contact.
 */
export const SUPPORT_EMAIL_ENV = "NEXT_PUBLIC_SUPPORT_EMAIL";

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const UNPUBLISHED_DOMAINS = new Set(["example.com", "example.org", "example.net", "example.edu"]);

export function parseSupportEmail(raw: string | undefined | null): string | null {
  const email = raw?.trim().toLowerCase() ?? "";
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return null;
  const domain = email.slice(email.indexOf("@") + 1);
  if (UNPUBLISHED_DOMAINS.has(domain)) return null;
  return email;
}

export function readSupportEmail(): string | null {
  return parseSupportEmail(process.env.NEXT_PUBLIC_SUPPORT_EMAIL);
}

/** A mailto URL for a published support address, or null when none is configured. */
export function supportMailto(raw: string | null | undefined): string | null {
  const email = parseSupportEmail(raw);
  if (!email) return null;
  const href = `mailto:${encodeURIComponent(email)}`;
  try {
    if (new URL(href).protocol !== "mailto:") return null;
  } catch {
    return null;
  }
  return href;
}
