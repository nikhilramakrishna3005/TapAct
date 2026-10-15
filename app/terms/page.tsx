import type { Metadata } from "next";
import { LegalDocument } from "../components/legal/LegalDocument";
import { termsSections } from "@/lib/legal/documents";

export const metadata: Metadata = {
  title: "Terms — TapAct",
  description: "House rules for the free, early-stage TapAct activity tracker.",
};

export default function TermsPage() {
  return (
    <LegalDocument
      title="Terms"
      lede="House rules for a free early-stage activity tracker. No company or office is identified for this project."
      sections={termsSections()}
    />
  );
}
