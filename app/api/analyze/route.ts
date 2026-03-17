import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error: "Direct ad hoc analysis has been retired. Use the persisted signal cycle endpoint instead.",
    },
    { status: 410 }
  );
}
