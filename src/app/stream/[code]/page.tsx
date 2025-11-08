'use client';

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Player = {
  name: string;
  isHost: boolean;
  joinedAt: number;
  score: number;
};

type GameStatus = "waiting" | "active" | "ended";

type GamePayload = {
  code: string;
  status: GameStatus;
  players: Player[];
  startedAt?: number;
  endedAt?: number;
  settings?: {
    gameDurationMinutes: number;
  };
  streamer?: {
    name: string;
    joinedAt: number;
  };
};

type OutboundMessage =
  | {
      type: "register";
      code: string;
      name: string;
      role: "streamer";
    }
  | {
      type: "answer";
      code: string;
      name: string;
      answer: RTCSessionDescriptionInit;
    }
  | {
      type: "candidate";
      code: string;
      name: string;
      candidate: RTCIceCandidateInit;
    }
  | { type: "leave"; code: string; name: string };

type InboundMessage =
  | {
      type: "registered";
      role: "streamer";
      players?: string[];
    }
  | { type: "offer"; name: string; offer: RTCSessionDescriptionInit }
  | { type: "candidate"; name: string; candidate: RTCIceCandidateInit }
  | { type: "player-left"; name: string }
  | { type: "error"; message: string };

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
];

export default function StreamerDashboardPage() {
  const params = useParams<{ code: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const code = (params.code ?? "").toUpperCase();
  const name = searchParams.get("name") ?? "Control Booth";

  const [game, setGame] = useState<GamePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLeaving, setIsLeaving] = useState(false);
  const [socketStatus, setSocketStatus] = useState<string | null>(null);
  const [feedVersion, setFeedVersion] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null); // in seconds
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const peerConnectionsRef = useRef(new Map<string, RTCPeerConnection>());
  const remoteStreamsRef = useRef(new Map<string, MediaStream>());

  const sendMessage = useCallback(
    (message: OutboundMessage) => {
      const socket = wsRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
      }
    },
    [],
  );

  const refreshFeeds = useCallback(() => {
    setFeedVersion((prev) => prev + 1);
  }, []);

  const getOrCreateStream = useCallback(
    (playerName: string) => {
      let stream = remoteStreamsRef.current.get(playerName);
      if (!stream) {
        stream = new MediaStream();
        remoteStreamsRef.current.set(playerName, stream);
      }
      return stream;
    },
    [],
  );

  const closePeerConnection = useCallback(
    (playerName: string) => {
      const pc = peerConnectionsRef.current.get(playerName);
      if (pc) {
        pc.close();
        peerConnectionsRef.current.delete(playerName);
      }
      const stream = remoteStreamsRef.current.get(playerName);
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        remoteStreamsRef.current.delete(playerName);
        refreshFeeds();
      }
    },
    [refreshFeeds],
  );

  const createPeerConnection = useCallback(
    (playerName: string) => {
      closePeerConnection(playerName);

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      peerConnectionsRef.current.set(playerName, pc);

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendMessage({
            type: "candidate",
            code,
            name: playerName,
            candidate: event.candidate.toJSON(),
          });
        }
      };

      pc.ontrack = (event) => {
        const stream = getOrCreateStream(playerName);
        stream.addTrack(event.track);
        refreshFeeds();
      };

      pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState;
        if (state === "failed" || state === "closed" || state === "disconnected") {
          // allow a new offer to re-establish connection
        }
      };

      return pc;
    },
    [closePeerConnection, code, getOrCreateStream, refreshFeeds, sendMessage],
  );

  const handleOffer = useCallback(
    async (playerName: string, offer: RTCSessionDescriptionInit) => {
      try {
        const pc = createPeerConnection(playerName);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendMessage({ type: "answer", code, name: playerName, answer });
        setSocketStatus((prev) =>
          prev === null ? "Receiving player feeds" : `Streaming ${playerName}`,
        );
      } catch (err) {
        console.error("Failed to handle offer", err);
        setSocketStatus("Unable to attach to player feed. Awaiting retry...");
      }
    },
    [code, createPeerConnection, sendMessage],
  );

  const handleCandidate = useCallback(
    async (playerName: string, candidate: RTCIceCandidateInit) => {
      const pc = peerConnectionsRef.current.get(playerName);
      if (!pc) {
        return;
      }
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error("Failed to add ICE candidate", error);
      }
    },
    [],
  );

  const fetchGame = useCallback(async () => {
    if (!code) {
      return;
    }

    try {
      const response = await fetch(`/api/game/${code}`, {
        cache: "no-store",
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to load lobby.");
      }

      setGame({
        ...data,
        players: (data.players as Player[]).slice().sort((a, b) => {
          if (b.score === a.score) {
            return a.joinedAt - b.joinedAt;
          }
          return b.score - a.score;
        }),
      });
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something broke.";
      setError(message);
    }
  }, [code]);

  useEffect(() => {
    void fetchGame();
    pollingRef.current = setInterval(() => {
      void fetchGame();
    }, 3000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [fetchGame]);

  useEffect(() => {
    return () => {
      void fetch(`/api/game/${code}/streamer`, { method: "DELETE" }).catch(() => undefined);
    };
  }, [code]);
  
  // Timer countdown effect
  useEffect(() => {
    if (!game || game.status !== "active" || !game.startedAt || !game.settings) {
      setTimeRemaining(null);
      return;
    }
    
    const updateTimer = () => {
      const now = Date.now();
      const elapsedMs = now - game.startedAt!;
      const durationMs = game.settings!.gameDurationMinutes * 60 * 1000;
      const remainingMs = Math.max(0, durationMs - elapsedMs);
      const remainingSec = Math.ceil(remainingMs / 1000);
      
      setTimeRemaining(remainingSec);
      
      // Auto-end game when time is up
      if (remainingSec <= 0 && game.status === "active") {
        fetch(`/api/game/${code}/end`, { method: "POST" })
          .then(() => fetchGame())
          .catch((err) => console.error("Failed to end game:", err));
      }
    };
    
    updateTimer(); // Initial update
    const timerInterval = setInterval(updateTimer, 1000); // Update every second
    
    return () => clearInterval(timerInterval);
  }, [game, code, fetchGame]);

  useEffect(() => {
    if (!code || !name) {
      return;
    }

    let isCancelled = false;

    const connect = async () => {
      try {
        await fetch("/api/signaling");
      } catch (error) {
        console.warn("Failed to ping signaling endpoint", error);
      }

      if (isCancelled) {
        return;
      }

      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${protocol}://${window.location.host}/api/signaling`);
      wsRef.current = ws;

      ws.onopen = () => {
        setSocketStatus("Waiting for player offers...");
        sendMessage({ type: "register", code, name, role: "streamer" });
      };

      ws.onmessage = async (event) => {
        let payload: InboundMessage;
        try {
          payload = JSON.parse(event.data);
        } catch (error) {
          console.error("Invalid signaling payload", error);
          return;
        }

        switch (payload.type) {
          case "registered": {
            if (payload.players?.length) {
              setSocketStatus(`Connected to ${payload.players.length} player${payload.players.length === 1 ? "" : "s"}. Waiting for video...`);
            }
            break;
          }
          case "offer": {
            await handleOffer(payload.name, payload.offer);
            break;
          }
          case "candidate": {
            await handleCandidate(payload.name, payload.candidate);
            break;
          }
          case "player-left": {
            closePeerConnection(payload.name);
            break;
          }
          case "error": {
            setSocketStatus(payload.message);
            break;
          }
          default:
            break;
        }
      };

      ws.onerror = (event) => {
        console.error("Signaling socket error", event);
        setSocketStatus("Signaling error. Reconnecting...");
      };

      ws.onclose = () => {
        if (!isCancelled) {
          setSocketStatus("Signaling connection closed. Reconnecting...");
          setTimeout(connect, 1500);
        }
      };
    };

    void connect();

    const peerMap = peerConnectionsRef.current;
    const streamMap = remoteStreamsRef.current;

    return () => {
      isCancelled = true;
      const socket = wsRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        sendMessage({ type: "leave", code, name });
        socket.close();
      }
      wsRef.current = null;
      const peers = Array.from(peerMap.values());
      peerMap.clear();
      peers.forEach((pc) => pc.close());
      const streams = Array.from(streamMap.values());
      streamMap.clear();
      streams.forEach((stream) => {
        stream.getTracks().forEach((track) => track.stop());
      });
      refreshFeeds();
    };
  }, [code, name, closePeerConnection, handleCandidate, handleOffer, refreshFeeds, sendMessage]);

  const handleLeave = useCallback(async () => {
    setIsLeaving(true);
    try {
      await fetch(`/api/game/${code}/streamer`, { method: "DELETE" });
    } catch {
      // ignore errors on leave
    } finally {
      setIsLeaving(false);
      router.push("/");
    }
  }, [code, router]);

  const statusBadge = useMemo(() => {
    const status = game?.status ?? "waiting";
    if (status === "active") {
      return "Match live";
    }
    return "Lobby waiting";
  }, [game?.status]);

  const streamerMismatch = useMemo(() => {
    if (!game?.streamer) {
      return false;
    }
    return game.streamer.name !== name;
  }, [game?.streamer, name]);

  return (
    <div className="flex h-screen flex-col bg-gradient-to-b from-slate-950 via-slate-900 to-black text-slate-100 overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 flex-shrink-0">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-fuchsia-300">
            Control booth
          </p>
          <h1 className="text-2xl font-bold text-white">{name}</h1>
          <p className="text-xs uppercase tracking-[0.4em] text-slate-400">
            Lobby {code}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full border border-fuchsia-400/40 bg-fuchsia-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-fuchsia-100">
            {statusBadge}
          </span>
          <button
            type="button"
            onClick={handleLeave}
            disabled={isLeaving}
            className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-200 transition hover:border-white/30 hover:text-white disabled:opacity-60"
          >
            {isLeaving ? "Leaving..." : "Disconnect"}
          </button>
          <Link
            href="/"
            className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:border-white/30 hover:text-white"
          >
            Exit
          </Link>
        </div>
      </header>

      {error ? (
        <div className="mx-6 mb-6 rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
          {error}
        </div>
      ) : null}
      {streamerMismatch ? (
        <div className="mx-6 mb-6 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
          Another device is currently streaming this lobby as {game?.streamer?.name}. Disconnect that device or
          rejoin from the control booth page.
        </div>
      ) : null}

      <main className="flex-1 px-4 pb-4 overflow-hidden min-h-0">
        <div className="flex h-full gap-4 flex-col lg:flex-row">
          <section className="flex flex-col rounded-2xl border border-white/5 bg-black/40 p-4 shadow-2xl lg:w-[30%] overflow-hidden min-h-0">
            {/* Timer Display */}
            {game?.status === "active" && timeRemaining !== null && (
              <div className="mb-4 flex items-center justify-center flex-shrink-0">
                <div className={`text-center rounded-xl border-2 px-6 py-3 ${
                  timeRemaining <= 60 
                    ? 'border-rose-500/60 bg-rose-500/20 animate-pulse' 
                    : 'border-emerald-500/40 bg-emerald-500/10'
                }`}>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-300 mb-1">
                    Time Remaining
                  </p>
                  <p className={`text-4xl font-bold font-mono ${
                    timeRemaining <= 60 ? 'text-rose-300' : 'text-emerald-300'
                  }`}>
                    {Math.floor(timeRemaining / 60)}:{String(timeRemaining % 60).padStart(2, '0')}
                  </p>
                </div>
              </div>
            )}
            
            <div className="flex items-center justify-between gap-4 flex-shrink-0">
              <h2 className="text-xl font-semibold text-white">Leaderboard</h2>
              <span className="text-xs uppercase tracking-[0.3em] text-slate-400">
                {game?.players.length ?? 0} {game?.players.length === 1 ? "player" : "players"}
              </span>
            </div>
            <div className="mt-4 grid flex-1 gap-2 overflow-auto content-start min-h-0"
                 style={{
                   gridTemplateColumns: game?.players.length === 1 ? '1fr' : `repeat(auto-fill, minmax(${Math.max(140, 300 / Math.ceil(Math.sqrt(game?.players.length ?? 1)))}px, 1fr))`
                 }}>
              {(game?.players ?? []).map((player, index) => (
                <div
                  key={`${player.name}-${player.joinedAt}`}
                  className="flex flex-col justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-base font-semibold text-white flex-1">
                      {player.name}
                      {player.isHost ? (
                        <span className="ml-2 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-emerald-200">
                          Host
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <p className="mt-2 text-3xl font-black text-cyan-300">
                    {player.score}
                  </p>
                </div>
              ))}
              {(game?.players?.length ?? 0) === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-sm text-slate-400">
                  Waiting for players to join.
                </div>
              ) : null}
            </div>
          </section>

          <section className="flex flex-col rounded-2xl border border-white/5 bg-black/40 p-4 shadow-2xl flex-1 overflow-hidden min-h-0">
            {game?.status === "ended" ? (
              /* End Game Screen */
              <div className="flex-1 flex flex-col items-center justify-center overflow-auto">
                <div className="text-center max-w-2xl p-4">
                  <h2 className="text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-rose-400 via-fuchsia-400 to-cyan-400 mb-4">
                    Game Over!
                  </h2>
                  <p className="text-lg text-slate-300 mb-8">Match complete</p>
                  
                  {game.players.length > 0 && (
                    <>
                      <div className="mb-8 p-6 rounded-2xl border-2 border-emerald-500/40 bg-emerald-500/10">
                        <p className="text-sm uppercase tracking-[0.3em] text-emerald-300 mb-2">Winner</p>
                        <p className="text-4xl font-bold text-white">{game.players[0].name}</p>
                        <p className="text-2xl text-emerald-200 mt-2">{game.players[0].score} points</p>
                      </div>
                      
                      <div className="space-y-2">
                        <p className="text-sm uppercase tracking-[0.3em] text-slate-400 mb-4">Final Scores</p>
                        {game.players.map((player, index) => (
                          <div key={player.name} className="flex items-center justify-between p-4 rounded-xl bg-white/5">
                            <div className="flex items-center gap-4">
                              <span className="text-2xl font-bold text-slate-400">#{index + 1}</span>
                              <span className="text-lg text-white">{player.name}</span>
                            </div>
                            <span className="text-xl font-bold text-emerald-300">{player.score} pts</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            ) : (
              /* Live Feeds Section */
              <>
                <div className="flex items-center justify-between gap-4 flex-shrink-0">
                  <h2 className="text-xl font-semibold text-white">Live feeds</h2>
                  <p className="text-[0.6rem] uppercase tracking-[0.3em] text-slate-400">
                    {socketStatus ?? "Waiting for players"}
                  </p>
                </div>
                <div
              className="mt-4 grid flex-1 gap-3 overflow-auto content-start min-h-0 justify-items-center"
              data-feed-version={feedVersion}
              style={{
                gridTemplateColumns: (() => {
                  const count = game?.players.length ?? 0;
                  if (count === 0 || count === 1) return '1fr';
                  if (count === 2) return 'repeat(2, 1fr)';
                  if (count === 3) return 'repeat(2, 1fr)';
                  if (count === 4) return 'repeat(2, 1fr)';
                  if (count === 5) return 'repeat(3, 1fr)';
                  if (count === 6) return 'repeat(3, 1fr)';
                  if (count === 7) return 'repeat(4, 1fr)';
                  if (count === 8) return 'repeat(4, 1fr)';
                  if (count === 9) return 'repeat(3, 1fr)';
                  return 'repeat(4, 1fr)';
                })(),
                gridAutoFlow: 'dense'
              }}
            >
              {(game?.players ?? []).map((player) => {
                const stream = remoteStreamsRef.current.get(player.name);
                const hasTrack = Boolean(stream && stream.getVideoTracks().length > 0);

                return (
                  <div
                    key={`feed-${player.name}`}
                    className="relative flex aspect-[4/3] w-full flex-col items-center justify-center overflow-hidden rounded-[1.75rem] border border-white/10 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4 text-center"
                  >
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(236,72,153,0.25),_transparent)]" />
                    {hasTrack ? (
                      <video
                        ref={(element) => {
                          if (element && stream && element.srcObject !== stream) {
                            element.srcObject = stream;
                            element.play().catch(() => undefined);
                          }
                        }}
                        playsInline
                        autoPlay
                        muted
                        className="relative z-10 h-full w-full rounded-[1.5rem] object-cover"
                      />
                    ) : (
                      <div className="relative z-10 flex flex-col items-center gap-2 text-slate-200">
                        <span className="rounded-full border border-fuchsia-400/40 bg-fuchsia-500/10 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.3em] text-fuchsia-100">
                          Standby
                        </span>
                        <p className="text-sm font-semibold text-white">{player.name}</p>
                        <p className="text-[0.6rem] text-slate-400">
                          Waiting for camera handshake.
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
              {(game?.players?.length ?? 0) === 0 ? (
                <div className="col-span-full flex h-full min-h-[14rem] w-full items-center justify-center rounded-[1.75rem] border border-dashed border-white/10 bg-black/40 text-sm text-slate-400">
                  Waiting for players to join.
                </div>
              ) : null}
                </div>
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
