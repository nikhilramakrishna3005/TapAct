import type { Metadata } from "next";
import { LegalDocument } from "../components/legal/LegalDocument";
import { privacySections } from "@/lib/legal/documents";

export const metadata: Metadata = {
  title: "Privacy — TapAct",
  description: "What TapAct stores on your device, what an optional account syncs, and what a duel opponent can see.",
};

export default function PrivacyPage() {
  return (
    <LegalDocument
      title="Privacy"
      lede="This page describes the information TapAct actually stores. An account, cloud backup, duels, and push notifications are all optional."
      sections={privacySections()}
    />
  );
}
