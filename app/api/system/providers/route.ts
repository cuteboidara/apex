import { NextResponse } from "next/server";

import { buildRouteErrorResponse } from "@/lib/api/routeErrors";
import { getProviderSummaries } from "@/lib/marketData/providerStatus";
import { classifyProviderStatus } from "@/lib/providerStatusClassifier";

export const dynamic = "force-dynamic";

type ProvidersRouteDependencies = {
  getProviderSummaries: typeof getProviderSummaries;
  classifyProviderStatus: typeof classifyProviderStatus;
};

export function createSystemProvidersRouteHandler(deps: ProvidersRouteDependencies) {
  return async function GET() {
    try {
      const providers = (await deps.getProviderSummaries()).map(provider => {
        const classified = deps.classifyProviderStatus(provider.status, provider.detail, provider.provider);

        return {
          ...provider,
          status: classified.displayStatus,
          availability: classified.availability,
          blockedReason: classified.blockedReason,
        };
      });

      const summary = {
        available: providers.filter(provider => provider.status === "available").length,
        degraded: providers.filter(provider => provider.status === "degraded").length,
        offline: providers.filter(provider => provider.status === "offline").length,
      };

      return NextResponse.json({
        ok: true,
        providers,
        summary,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return buildRouteErrorResponse(error, {
        publicMessage: "Unable to load provider health.",
      });
    }
  };
}

export const GET = createSystemProvidersRouteHandler({
  getProviderSummaries,
  classifyProviderStatus,
});
