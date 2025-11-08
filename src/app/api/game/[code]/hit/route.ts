import { NextRequest, NextResponse } from "next/server";
import { updatePlayerScore, getGame } from "@/lib/gameStore";

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

    // Get the player's current selected gun to determine point multiplier
    const gameData = getGame(code);
    const player = gameData.players.find(
      (p) => p.name.toLowerCase() === playerName.toLowerCase()
    );
    
    if (!player) {
      return NextResponse.json(
        { error: "Player not found." },
        { status: 404 },
      );
    }
    
    // Award points based on gun type (client already consumed ammo)
    const pointsMultiplier = player.selectedGun === 2 ? 3 : 1;
    const game = updatePlayerScore(code, playerName, pointsMultiplier);

    return NextResponse.json(game);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

