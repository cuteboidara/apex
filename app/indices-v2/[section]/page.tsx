import { redirect } from "next/navigation";
import { IndicesV2Dashboard } from "@/src/presentation/indices/IndicesV2Dashboard";
import { normalizeAMTSection } from "@/src/presentation/indices/sections";

export default async function IndicesV2SectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  const normalizedSection = normalizeAMTSection(section);

  if (!normalizedSection) {
    redirect("/indices-v2");
  }

  if (normalizedSection === "overview") {
    redirect("/indices-v2");
  }

  if (normalizedSection !== section.toLowerCase()) {
    redirect(`/indices-v2/${normalizedSection}`);
  }

  return <IndicesV2Dashboard section={normalizedSection} />;
}
