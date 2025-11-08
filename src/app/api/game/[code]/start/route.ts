import { NextResponse } from "next/server";

import { startGame } from "@/lib/gameStore";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await context.params;
    const game = startGame(code);
    return NextResponse.json(game, { status: 200 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to start game.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
