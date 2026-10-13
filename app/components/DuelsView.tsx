"use client";

import { Swords } from "lucide-react";
import { EmptyState, ScreenHeader } from "./ui";

export function DuelsView() {
  return (
    <>
      <ScreenHeader eyebrow="Duels" title="Challenge a friend." />
      <section className="panel mt-6 px-4 py-6">
        <EmptyState
          icon={Swords}
          title="Duels are almost here"
          body="Invite a friend to a timed challenge and compare tracked time. This screen is ready — scoring and invites come next."
        />
      </section>
    </>
  );
}
