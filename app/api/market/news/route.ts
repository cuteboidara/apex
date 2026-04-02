import { deprecatedEndpointResponse } from "@/src/presentation/api/deprecated";

export async function GET() {
  return deprecatedEndpointResponse();
}

export async function POST() {
  return deprecatedEndpointResponse();
}
