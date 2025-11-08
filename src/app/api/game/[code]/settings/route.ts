import { NextRequest, NextResponse } from "next/server";
import { updateGameSettings } from "@/lib/gameStore";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await params;
    const body = await request.json();
    const { hostName, settings } = body;

    if (!hostName) {
      return NextResponse.json(
        { error: "Host name is required." },
        { status: 400 },
      );
    }

    if (!settings) {
      return NextResponse.json(
        { error: "Settings are required." },
        { status: 400 },
      );
    }

    const game = updateGameSettings(code, hostName, settings);

    return NextResponse.json(game);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

