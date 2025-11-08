import { NextRequest, NextResponse } from "next/server";
import { updatePlayerScore } from "@/lib/gameStore";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await params;
    const body = await request.json();
    const { playerName, targetColor } = body;

    if (!playerName) {
      return NextResponse.json(
        { error: "Player name is required." },
        { status: 400 },
      );
    }

    // Each hit = 1 point
    const game = updatePlayerScore(code, playerName, 1);

    return NextResponse.json(game);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

