import { NextResponse } from "next/server";

export function deprecatedEndpointResponse() {
  return NextResponse.json({ error: "This endpoint has been deprecated" }, { status: 410 });
}
