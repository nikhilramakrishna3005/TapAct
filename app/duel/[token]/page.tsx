"use client";

import { use } from "react";
import { AuthProvider } from "../../components/AuthProvider";
import { DuelInvite } from "../../components/duels/DuelInvite";
import { MotionPrefsProvider } from "../../components/MotionPrefs";

export default function DuelInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  return (
    <MotionPrefsProvider>
      <AuthProvider>
        <DuelInvite token={token} />
      </AuthProvider>
    </MotionPrefsProvider>
  );
}
