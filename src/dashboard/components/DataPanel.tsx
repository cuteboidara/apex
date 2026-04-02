import type { ReactNode } from "react";

import { SectionHeader } from "@/src/components/apex-ui/SectionHeader";

export function DataPanel({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
}) {
  return (
    <section className="apex-surface apex-fade-in px-6 py-6">
      <SectionHeader title={title} subtitle={eyebrow} />
      {children}
    </section>
  );
}
