import { redirect } from "next/navigation";

import { IndicesV2Dashboard } from "@/src/presentation/indices/IndicesV2Dashboard";
import {
  isAMTClassSection,
  normalizeAMTAsset,
  normalizeAMTSection,
} from "@/src/presentation/indices/sections";

export default async function IndicesV2AssetPage({
  params,
}: {
  params: Promise<{ section: string; asset: string }>;
}) {
  const { section, asset } = await params;
  const normalizedSection = normalizeAMTSection(section);

  if (!normalizedSection || !isAMTClassSection(normalizedSection)) {
    redirect("/indices-v2");
  }

  const normalizedAsset = normalizeAMTAsset(normalizedSection, asset);
  if (!normalizedAsset) {
    redirect(`/indices-v2/${normalizedSection}`);
  }

  if (section.toLowerCase() !== normalizedSection || asset.toLowerCase() !== normalizedAsset.toLowerCase()) {
    redirect(`/indices-v2/${normalizedSection}/${normalizedAsset.toLowerCase()}`);
  }

  return <IndicesV2Dashboard section={normalizedSection} asset={normalizedAsset} />;
}
