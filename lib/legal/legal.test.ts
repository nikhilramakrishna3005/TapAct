import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { privacySections, termsSections, UNPUBLISHED_SUPPORT } from "./documents";
import { parseSupportEmail, readSupportEmail, SUPPORT_EMAIL_ENV } from "./support";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function prose(sections: { heading: string; paragraphs: string[] }[]): string {
  return sections.flatMap((section) => [section.heading, ...section.paragraphs]).join("\n");
}

const original = process.env[SUPPORT_EMAIL_ENV];

afterEach(() => {
  if (original === undefined) delete process.env[SUPPORT_EMAIL_ENV];
  else process.env[SUPPORT_EMAIL_ENV] = original;
});

describe("support contact", () => {
  it("publishes only a configured address and rejects sample domains", () => {
    expect(parseSupportEmail(undefined)).toBeNull();
    expect(parseSupportEmail("  ")).toBeNull();
    expect(parseSupportEmail("not-an-email")).toBeNull();
    expect(parseSupportEmail("example@example.com")).toBeNull();
    expect(parseSupportEmail("You@Example.com")).toBeNull();
    expect(parseSupportEmail("person@example.org")).toBeNull();
    expect(parseSupportEmail("person@example.net")).toBeNull();
    expect(parseSupportEmail("maintainer@tapact.dev")).toBe("maintainer@tapact.dev");
    expect(parseSupportEmail("  Maintainer@TapAct.dev ")).toBe("maintainer@tapact.dev");
  });

  it("reads the public env var and hides it when unset", () => {
    delete process.env[SUPPORT_EMAIL_ENV];
    expect(readSupportEmail()).toBeNull();
    process.env[SUPPORT_EMAIL_ENV] = "example@example.com";
    expect(readSupportEmail()).toBeNull();
    process.env[SUPPORT_EMAIL_ENV] = "maintainer@tapact.dev";
    expect(readSupportEmail()).toBe("maintainer@tapact.dev");
  });
});

describe("privacy and terms copy", () => {
  it("describes real data flows and the missing deletion control", () => {
    const privacy = prose(privacySections(null));
    expect(privacy).toContain("Supabase Auth");
    expect(privacy).toContain("stored in this browser first");
    expect(privacy).toContain("Guest history is not uploaded");
    expect(privacy).toContain("Your email address is not used as that name");
    expect(privacy).toContain("Share when I'm tracking a duel activity");
    expect(privacy).toContain("stores only a hash of that token");
    expect(privacy).toContain("does not include your activity list or timer history");
    expect(privacy).toContain("TapAct does not yet offer account deletion");
    expect(privacy).toContain("Signing out is not deletion");
    expect(privacy).toContain("Supabase");
    expect(privacy).toContain("Vercel");
    expect(privacy).toContain(UNPUBLISHED_SUPPORT);
    expect(privacy).not.toContain("example@example.com");
    expect(privacy).not.toContain("account deletion is available");
    expect(privacy.toLowerCase()).not.toContain("warranty");
    expect(privacy).not.toMatch(/\bInc\b|\bLLC\b|\bLtd\b/);
  });

  it("keeps terms short and free of an invented company", () => {
    const terms = prose(termsSections("maintainer@tapact.dev"));
    expect(terms).toContain("free, early-stage");
    expect(terms).toContain("Self-serve account deletion is not available yet");
    expect(terms).toContain("maintainer@tapact.dev");
    expect(terms).toContain("Writing to it does not delete an account");
    expect(terms).not.toContain("example@example.com");
    expect(terms.toLowerCase()).not.toContain("warranty");
    expect(terms).not.toMatch(/\bInc\b|\bLLC\b|\bLtd\b/);
  });
});

describe("legal routes and entry points", () => {
  it("publishes both pages from the shared copy", () => {
    const privacy = source("app/privacy/page.tsx");
    const terms = source("app/terms/page.tsx");
    expect(privacy).toContain('title: "Privacy — TapAct"');
    expect(privacy).toContain("privacySections()");
    expect(terms).toContain('title: "Terms — TapAct"');
    expect(terms).toContain("termsSections()");
    const document = source("app/components/legal/LegalDocument.tsx");
    expect(document).toContain('href="/"');
    expect(document).toContain("safe-area-inset-bottom");
    expect(document).toContain("safe-area-inset-top");
    expect(document).toContain("mailto:");
    expect(document).toContain("<h1");
  });

  it("links privacy and terms from signup, account, and About, and shows support there", () => {
    const auth = source("app/components/auth/AuthScreen.tsx");
    const signup = auth.slice(auth.indexOf('mode === "sign-up"'), auth.indexOf('mode === "forgot"'));
    expect(signup).toContain("Cloud sync starts only");
    expect(signup).not.toContain("until cloud sync arrives");
    expect(auth).toContain("<LegalLinks");
    const account = source("app/components/AccountSection.tsx");
    expect(account).toContain("<LegalLinks");
    const settings = source("app/components/SettingsView.tsx");
    const about = settings.slice(settings.indexOf('title="About"'));
    expect(about).toContain("<h3");
    expect(about).toContain("Support");
    expect(about).toContain("A support address has not been published yet.");
    expect(about).toContain("mailto:");
    expect(about).toContain("<LegalLinks");
    const links = source("app/components/legal/LegalLinks.tsx");
    expect(links).toContain('href="/privacy"');
    expect(links).toContain('href="/terms"');
    expect(links).toContain('aria-label="Privacy and terms"');
    const env = source(".env.example");
    expect(env).toContain("NEXT_PUBLIC_SUPPORT_EMAIL");
    expect(env).not.toContain("example@example.com");
  });
});
