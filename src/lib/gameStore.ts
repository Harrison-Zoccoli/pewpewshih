import { randomUUID } from "node:crypto";

type Player = {
  id: string;
  name: string;
  isHost: boolean;
  joinedAt: number;
  score: number;
  gun1Ammo: number;
  gun2Ammo: number;
  selectedGun: 1 | 2;
};

export type PublicPlayer = Pick<
  Player,
  "name" | "isHost" | "joinedAt" | "score" | "gun1Ammo" | "gun2Ammo" | "selectedGun"
>;

type Streamer = {
  id: string;
  name: string;
  joinedAt: number;
};

export type PublicStreamer = Omit<Streamer, "id">;

export type GameStatus = "waiting" | "active";

type GameSettings = {
  showBoundingBoxes: boolean;
};

export type PublicGameSettings = GameSettings;

export type PublicGame = {
  code: string;
  status: GameStatus;
  players: PublicPlayer[];
  createdAt: number;
  startedAt?: number;
  streamer?: PublicStreamer;
  settings: PublicGameSettings;
};

type Game = {
  code: string;
  players: Player[];
  createdAt: number;
  startedAt?: number;
  status: GameStatus;
  streamer?: Streamer;
  settings: GameSettings;
};

const games = new Map<string, Game>();

const PLAYER_NAME_MAX_LENGTH = 24;

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 5;

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

function normalizeName(name: string): string {
  return name.trim();
}

function generateGameCode(): string {
  let code = "";
  do {
    code = Array.from({ length: CODE_LENGTH }, () =>
      CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)],
    ).join("");
  } while (games.has(code));
  return code;
}

function toPublicPlayer(player: Player): PublicPlayer {
  const { name, isHost, joinedAt, score, gun1Ammo, gun2Ammo, selectedGun } = player;
  return { name, isHost, joinedAt, score, gun1Ammo, gun2Ammo, selectedGun };
}

function toPublicGame(game: Game): PublicGame {
  return {
    code: game.code,
    status: game.status,
    players: game.players.map(toPublicPlayer),
    createdAt: game.createdAt,
    startedAt: game.startedAt,
    streamer: game.streamer
      ? {
          name: game.streamer.name,
          joinedAt: game.streamer.joinedAt,
        }
      : undefined,
    settings: game.settings,
  };
}

export function createGame(hostNameInput: string | undefined) {
  const hostName = normalizeName(hostNameInput ?? "") || "Host";
  if (hostName.length > PLAYER_NAME_MAX_LENGTH) {
    throw new Error("Host name is too long.");
  }

  const code = generateGameCode();
  const now = Date.now();
  const host: Player = {
    id: randomUUID(),
    name: hostName,
    isHost: true,
    joinedAt: now,
    score: 0,
    gun1Ammo: 10,
    gun2Ammo: 3,
    selectedGun: 1,
  };

  const game: Game = {
    code,
    players: [host],
    createdAt: now,
    status: "waiting",
    settings: {
      showBoundingBoxes: true,
    },
  };

  games.set(code, game);

  return toPublicGame(game);
}

export function joinGame(codeInput: string, playerNameInput: string) {
  const code = normalizeCode(codeInput);
  const playerName = normalizeName(playerNameInput);

  if (!code) {
    throw new Error("Game code is required.");
  }

  const game = games.get(code);
  if (!game) {
    throw new Error("Game not found.");
  }

  if (!playerName) {
    throw new Error("Player name is required.");
  }

  if (playerName.length > PLAYER_NAME_MAX_LENGTH) {
    throw new Error("Player name is too long.");
  }

  const existing = game.players.find(
    (player) => player.name.toLowerCase() === playerName.toLowerCase(),
  );

  if (existing) {
    throw new Error("That name is already taken in this lobby.");
  }

  const player: Player = {
    id: randomUUID(),
    name: playerName,
    isHost: false,
    joinedAt: Date.now(),
    score: 0,
    gun1Ammo: 10,
    gun2Ammo: 3,
    selectedGun: 1,
  };

  game.players.push(player);

  return toPublicGame(game);
}

export function getGame(codeInput: string) {
  const code = normalizeCode(codeInput);
  if (!code) {
    throw new Error("Game code is required.");
  }

  const game = games.get(code);
  if (!game) {
    throw new Error("Game not found.");
  }

  return toPublicGame(game);
}

export function removeGame(codeInput: string) {
  const code = normalizeCode(codeInput);
  if (!code) {
    return false;
  }
  return games.delete(code);
}

export function startGame(codeInput: string) {
  const code = normalizeCode(codeInput);
  if (!code) {
    throw new Error("Game code is required.");
  }

  const game = games.get(code);
  if (!game) {
    throw new Error("Game not found.");
  }

  if (game.status === "active") {
    return toPublicGame(game);
  }

  game.status = "active";
  game.startedAt = Date.now();

  return toPublicGame(game);
}

export function registerStreamer(codeInput: string, nameInput: string) {
  const code = normalizeCode(codeInput);
  const name = normalizeName(nameInput);

  if (!code) {
    throw new Error("Game code is required.");
  }

  if (!name) {
    throw new Error("Streamer name is required.");
  }

  const game = games.get(code);
  if (!game) {
    throw new Error("Game not found.");
  }

  if (game.streamer) {
    throw new Error("This lobby already has a streamer connected.");
  }

  const streamer: Streamer = {
    id: randomUUID(),
    name,
    joinedAt: Date.now(),
  };

  game.streamer = streamer;

  return toPublicGame(game);
}

export function unregisterStreamer(codeInput: string) {
  const code = normalizeCode(codeInput);
  if (!code) {
    throw new Error("Game code is required.");
  }

  const game = games.get(code);
  if (!game) {
    throw new Error("Game not found.");
  }

  game.streamer = undefined;

  return toPublicGame(game);
}

export function updatePlayerScore(
  codeInput: string,
  playerName: string,
  pointsToAdd: number,
) {
  const code = normalizeCode(codeInput);
  const normalizedPlayerName = normalizeName(playerName);

  if (!code) {
    throw new Error("Game code is required.");
  }

  const game = games.get(code);
  if (!game) {
    throw new Error("Game not found.");
  }

  const player = game.players.find(
    (p) => p.name.toLowerCase() === normalizedPlayerName.toLowerCase(),
  );

  if (!player) {
    throw new Error("Player not found in this game.");
  }

  player.score += pointsToAdd;

  return toPublicGame(game);
}

export function updateGameSettings(
  codeInput: string,
  hostName: string,
  settings: Partial<GameSettings>,
) {
  const code = normalizeCode(codeInput);
  const normalizedHostName = normalizeName(hostName);

  if (!code) {
    throw new Error("Game code is required.");
  }

  const game = games.get(code);
  if (!game) {
    throw new Error("Game not found.");
  }

  const host = game.players.find((p) => p.isHost);

  if (!host || host.name.toLowerCase() !== normalizedHostName.toLowerCase()) {
    throw new Error("Only the host can change game settings.");
  }

  game.settings = { ...game.settings, ...settings };

  return toPublicGame(game);
}

export function switchGun(
  codeInput: string,
  playerName: string,
  gunNumber: 1 | 2,
) {
  const code = normalizeCode(codeInput);
  const normalizedPlayerName = normalizeName(playerName);

  if (!code) {
    throw new Error("Game code is required.");
  }

  const game = games.get(code);
  if (!game) {
    throw new Error("Game not found.");
  }

  const player = game.players.find(
    (p) => p.name.toLowerCase() === normalizedPlayerName.toLowerCase(),
  );

  if (!player) {
    throw new Error("Player not found in this game.");
  }

  player.selectedGun = gunNumber;

  return toPublicGame(game);
}

export function consumeAmmo(
  codeInput: string,
  playerName: string,
) {
  const code = normalizeCode(codeInput);
  const normalizedPlayerName = normalizeName(playerName);

  if (!code) {
    throw new Error("Game code is required.");
  }

  const game = games.get(code);
  if (!game) {
    throw new Error("Game not found.");
  }

  const player = game.players.find(
    (p) => p.name.toLowerCase() === normalizedPlayerName.toLowerCase(),
  );

  if (!player) {
    throw new Error("Player not found in this game.");
  }

  const gun = player.selectedGun;
  const ammoKey = gun === 1 ? 'gun1Ammo' : 'gun2Ammo';
  
  if (player[ammoKey] <= 0) {
    throw new Error("No ammo remaining.");
  }

  player[ammoKey] -= 1;

  return {
    game: toPublicGame(game),
    gun,
    pointsMultiplier: gun === 2 ? 3 : 1,
  };
}

export function updateAmmo(
  codeInput: string,
  playerName: string,
  gun1Ammo: number,
  gun2Ammo: number,
) {
  const code = normalizeCode(codeInput);
  const normalizedPlayerName = normalizeName(playerName);

  if (!code) {
    throw new Error("Game code is required.");
  }

  const game = games.get(code);
  if (!game) {
    throw new Error("Game not found.");
  }

  const player = game.players.find(
    (p) => p.name.toLowerCase() === normalizedPlayerName.toLowerCase(),
  );

  if (!player) {
    throw new Error("Player not found in this game.");
  }

  player.gun1Ammo = Math.max(0, Math.min(10, gun1Ammo));
  player.gun2Ammo = Math.max(0, Math.min(3, gun2Ammo));

  return toPublicGame(game);
}
