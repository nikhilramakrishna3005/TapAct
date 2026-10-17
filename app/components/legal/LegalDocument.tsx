import Link from "next/link";
import { Fragment } from "react";
import type { LegalSection } from "@/lib/legal/documents";
import { LEGAL_UPDATED } from "@/lib/legal/documents";
import { readSupportEmail, supportMailto } from "@/lib/legal/support";
import { OrbitMark } from "../Orbit";
import { LegalLinks } from "./LegalLinks";

function ContactText({ text, email, href }: { text: string; email: string | null; href: string | null }) {
  if (!email || !href || !text.includes(email)) return text;
  const parts = text.split(email);
  return parts.map((part, index) => (
    <Fragment key={`${index}-${part}`}>
      {part}
      {index < parts.length - 1 ? (
        <a
          href={href}
          className="font-medium text-volt-hi underline decoration-volt/40 underline-offset-4 [overflow-wrap:anywhere]"
        >
          {email}
        </a>
      ) : null}
    </Fragment>
  ));
}

export function LegalDocument({
  title,
  lede,
  sections,
}: {
  title: string;
  lede: string;
  sections: LegalSection[];
}) {
  const email = readSupportEmail();
  const href = supportMailto(email);
  return (
    <div className="min-h-[100dvh] bg-background text-text-1">
      <div className="mx-auto flex w-full max-w-[40rem] flex-col px-5 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <header className="flex h-12 items-center justify-between">
          <Link
            href="/"
            className="-ml-2 inline-flex min-h-11 items-center rounded-full px-2 text-sm font-medium text-text-2 transition-colors hover:text-text-1"
          >
            Back
          </Link>
          <div className="flex items-center gap-2">
            <OrbitMark size={22} />
            <span className="text-[0.95rem] font-semibold tracking-[-0.03em]">TapAct</span>
          </div>
          <span className="w-11" aria-hidden="true" />
        </header>
        <main className="mt-6">
          <h1 className="text-[1.7rem] font-semibold tracking-[-0.03em]">{title}</h1>
          <p className="mt-3 text-sm leading-relaxed text-text-2">{lede}</p>
          <p className="mt-2 text-xs text-text-3">Updated {LEGAL_UPDATED}</p>
          <div className="mt-8 space-y-8">
            {sections.map((section) => (
              <section key={section.id} aria-labelledby={section.id} className="space-y-3">
                <h2 id={section.id} className="text-base font-semibold tracking-[-0.02em]">
                  {section.heading}
                </h2>
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph} className="text-sm leading-relaxed text-text-2">
                    <ContactText text={paragraph} email={email} href={href} />
                  </p>
                ))}
              </section>
            ))}
          </div>
          <div className="mt-10 border-t border-line pt-4">
            {email && href ? (
              <>
                <h2 className="text-base font-semibold">Support</h2>
                <p className="mt-2 text-sm leading-relaxed text-text-2">
                  <a
                    href={href}
                    className="inline-flex min-h-11 items-center font-medium text-volt-hi underline decoration-volt/40 underline-offset-4 [overflow-wrap:anywhere]"
                  >
                    {email}
                  </a>
                </p>
              </>
            ) : null}
            <LegalLinks />
          </div>
        </main>
      </div>
    </div>
  );
}
