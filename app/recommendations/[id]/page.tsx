import { RecommendationDetailPage } from "@/src/dashboard/RecommendationDetailPage";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RecommendationDetailPage snapshotId={id} />;
}
