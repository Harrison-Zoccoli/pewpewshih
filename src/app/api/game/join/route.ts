import { NextResponse } from "next/server";

import { joinGame } from "@/lib/gameStore";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { code, name } = body as { code?: string; name?: string };

    const game = joinGame(code ?? "", name ?? "");

    return NextResponse.json(game, { status: 200 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to join game.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
