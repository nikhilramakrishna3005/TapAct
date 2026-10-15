import Link from "next/link";

export function LegalLinks({ className = "" }: { className?: string }) {
  return (
    <nav aria-label="Privacy and terms" className={`flex flex-wrap items-center gap-x-4 gap-y-1 ${className}`}>
      <Link
        href="/privacy"
        className="inline-flex min-h-11 items-center text-[0.78rem] font-medium text-volt-hi underline decoration-volt/40 underline-offset-4"
      >
        Privacy
      </Link>
      <Link
        href="/terms"
        className="inline-flex min-h-11 items-center text-[0.78rem] font-medium text-volt-hi underline decoration-volt/40 underline-offset-4"
      >
        Terms
      </Link>
    </nav>
  );
}
