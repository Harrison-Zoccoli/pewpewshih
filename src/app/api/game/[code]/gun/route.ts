import { NextRequest, NextResponse } from "next/server";
import { switchGun } from "@/lib/gameStore";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const body = await request.json();
    const { playerName, gunNumber } = body;

    if (!playerName) {
      return NextResponse.json(
        { error: "Player name is required." },
        { status: 400 }
      );
    }

    if (gunNumber !== 1 && gunNumber !== 2) {
      return NextResponse.json(
        { error: "Gun number must be 1 or 2." },
        { status: 400 }
      );
    }

    const game = switchGun(code, playerName, gunNumber);

    return NextResponse.json(game);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

