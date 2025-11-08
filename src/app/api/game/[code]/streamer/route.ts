import { NextResponse } from "next/server";

import { registerStreamer, unregisterStreamer } from "@/lib/gameStore";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ code: string }> },
) {
  try {
    const body = await request.json().catch(() => ({}));
    const { name } = body as { name?: string };
    const { code } = await context.params;

    const game = registerStreamer(code, name ?? "Streamer");
    return NextResponse.json(game, { status: 200 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to register streamer.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await context.params;
    const game = unregisterStreamer(code);
    return NextResponse.json(game, { status: 200 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to remove streamer.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
