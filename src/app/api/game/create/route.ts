import { NextResponse } from "next/server";

import { createGame } from "@/lib/gameStore";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { hostName } = body as { hostName?: string };

    const game = createGame(hostName);

    return NextResponse.json(game, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to create game.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
