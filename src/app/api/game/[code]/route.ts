import { NextResponse } from "next/server";

import { getGame } from "@/lib/gameStore";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await context.params;
    const game = getGame(code);
    return NextResponse.json(game, { status: 200 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to fetch game.";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
