'use client';

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Player = {
  name: string;
  isHost: boolean;
  joinedAt: number;
};

type LobbyFetchState = "loading" | "ready" | "missing" | "error";
type GameStatus = "waiting" | "active" | "ended";
type CameraStatus = "idle" | "requesting" | "granted" | "denied" | "unsupported";

export default function LobbyPage() {
  const params = useParams<{ code: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const rawCode = params.code ?? "";
  const code = rawCode.toUpperCase();
  const localName = searchParams.get("name") ?? "";
  const isHost = searchParams.get("host") === "1";

  const [players, setPlayers] = useState<Player[]>([]);
  const [fetchState, setFetchState] = useState<LobbyFetchState>("loading");
  const [gameStatus, setGameStatus] = useState<GameStatus>("waiting");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>("idle");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const hasRequestedCamera = useRef(false);
  const [showBoundingBoxes, setShowBoundingBoxes] = useState(true);
  const [gameDuration, setGameDuration] = useState(3); // Default 3 minutes
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const fetchLobby = useCallback(async () => {
    if (!code) {
      return;
    }

    try {
      const response = await fetch(`/api/game/${code}`, {
        cache: "no-store",
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Lobby unavailable.");
      }

      const sortedPlayers = (data.players as Player[]).slice().sort((a, b) => {
        return a.joinedAt - b.joinedAt;
      });

      setPlayers(sortedPlayers);
      setGameStatus((data.status as GameStatus) ?? "waiting");
      setShowBoundingBoxes(data.settings?.showBoundingBoxes ?? true);
      setGameDuration(data.settings?.gameDurationMinutes ?? 3);
      setFetchState("ready");
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something broke.";
      setError(message);
      setFetchState((prev) => (prev === "ready" ? "error" : "missing"));
    }
  }, [code]);

  useEffect(() => {
    let active = true;

    const tick = async () => {
      if (!active) return;
      await fetchLobby();
    };

    void tick();
    const interval = setInterval(tick, 3000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [fetchLobby]);

  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timeout);
  }, [copied]);

  useEffect(() => {
    if (fetchState !== "ready") {
      return;
    }
    if (hasRequestedCamera.current) {
      return;
    }
    hasRequestedCamera.current = true;

    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      setCameraStatus("unsupported");
      setCameraError(
        "Camera access requires HTTPS and a supported browser. Use a secure connection to prep your HUD.",
      );
      return;
    }

    setCameraStatus("requesting");
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      })
      .then((stream) => {
        stream.getTracks().forEach((track) => track.stop());
        setCameraStatus("granted");
        setCameraError(null);
      })
      .catch((err) => {
        const message =
          err instanceof Error ? err.message : "Unable to access camera.";
        setCameraStatus("denied");
        setCameraError(message);
      });
  }, [fetchState]);

  useEffect(() => {
    if (gameStatus !== "active") {
      return;
    }

    const search = new URLSearchParams();
    if (localName) {
      search.set("name", localName);
    }
    if (isHost) {
      search.set("host", "1");
    }

    router.replace(`/arena/${code}?${search.toString()}`);
  }, [code, gameStatus, isHost, localName, router]);

  const handleStartGame = useCallback(async () => {
    if (!code) {
      return;
    }

    setIsStarting(true);
    setStartError(null);
    try {
      const response = await fetch(`/api/game/${code}/start`, {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to start lobby.");
      }

      setGameStatus((data.status as GameStatus) ?? "active");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start.";
      setStartError(message);
    } finally {
      setIsStarting(false);
    }
  }, [code]);

  const handleCopyCode = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch (err) {
      console.error("Clipboard copy failed", err);
    }
  }, [code]);

  const handleToggleBoundingBoxes = useCallback(async () => {
    try {
      setSettingsError(null);
      const newValue = !showBoundingBoxes;
      
      const response = await fetch(`/api/game/${code}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hostName: localName,
          settings: { showBoundingBoxes: newValue },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to update settings.");
      }

      setShowBoundingBoxes(newValue);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update settings.";
      setSettingsError(message);
    }
  }, [code, localName, showBoundingBoxes]);
  
  const handleGameDurationChange = useCallback(async (minutes: number) => {
    try {
      setSettingsError(null);
      
      const response = await fetch(`/api/game/${code}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hostName: localName,
          settings: { gameDurationMinutes: minutes },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to update settings.");
      }

      setGameDuration(minutes);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update settings.";
      setSettingsError(message);
    }
  }, [code, localName]);

  const lobbyMessage = useMemo(() => {
    if (fetchState === "loading") return "Setting up your lobby...";
    if (fetchState === "missing") return "We couldn’t find that lobby.";
    if (fetchState === "error") return "Connection hiccup. Trying again.";
    if (gameStatus === "active") return "Booting up Pew Pew HUD...";
    return isHost ? "Share the code and wait for your squad." : "Hang tight while everyone gears up.";
  }, [fetchState, gameStatus, isHost]);

  const cameraMessage = useMemo(() => {
    if (cameraStatus === "idle") return "";
    if (cameraStatus === "requesting") return "Requesting camera permission...";
    if (cameraStatus === "granted") return "Camera ready. You’re cleared for AR targeting.";
    if (cameraStatus === "denied")
      return cameraError ?? "Camera permissions denied. Enable the camera to play.";
    if (cameraStatus === "unsupported")
      return (
        cameraError ??
        "Camera access unavailable on this device. Use HTTPS or switch browsers to prep your HUD."
      );
    return "";
  }, [cameraError, cameraStatus]);

  return (
    <div className="flex min-h-screen flex-col items-center bg-gradient-to-b from-slate-950 via-slate-900 to-black px-4 py-20 text-slate-100">
      <main className="w-full max-w-4xl space-y-12">
        <header className="flex flex-col gap-6 rounded-3xl border border-white/5 bg-white/5 p-10 shadow-xl backdrop-blur">
          <Link href="/" className="text-sm text-slate-400 hover:text-slate-200">
            ← Back
          </Link>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.4em] text-slate-400">
                Lobby code
              </p>
              <div className="mt-2 flex items-center gap-4">
                <span className="text-4xl font-black tracking-[0.4em] text-white">
                  {code}
                </span>
                <button
                  type="button"
                  onClick={handleCopyCode}
                  className="rounded-full border border-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-200 transition hover:border-emerald-400 hover:text-emerald-300"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-5 py-4 text-sm font-medium text-emerald-200">
              {lobbyMessage}
            </div>
          </div>
          {error ? <p className="text-sm text-rose-300">{error}</p> : null}
          {startError ? (
            <p className="text-sm text-rose-300">{startError}</p>
          ) : null}
          {cameraMessage ? (
            <p
              className={`text-sm ${
                cameraStatus === "granted"
                  ? "text-emerald-200"
                  : cameraStatus === "requesting"
                    ? "text-slate-200"
                    : "text-rose-300"
              }`}
            >
              {cameraMessage}
            </p>
          ) : null}
        </header>

        <section className="rounded-3xl border border-white/5 bg-white/5 p-10 shadow-xl backdrop-blur">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-semibold text-white">Crew manifest</h2>
            <span className="text-sm text-slate-400">
              {players.length} {players.length === 1 ? "player" : "players"}
            </span>
          </div>
          <ul className="mt-8 space-y-4">
            {players.map((player) => {
              const isYou = player.name.toLowerCase() === localName.toLowerCase();
              return (
                <li
                  key={`${player.name}-${player.joinedAt}`}
                  className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/30 px-6 py-4 text-slate-200"
                >
                  <div>
                    <p className="text-lg font-semibold text-white">
                      {player.name}
                      {player.isHost ? <span className="ml-3 rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-200">Host</span> : null}
                      {isYou ? <span className="ml-3 rounded-full bg-sky-500/20 px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] text-sky-200">You</span> : null}
                    </p>
                    <p className="text-xs uppercase tracking-[0.4em] text-slate-400">
                      Joined {new Date(player.joinedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
          {players.length === 0 && fetchState !== "loading" ? (
            <p className="mt-6 text-center text-sm text-slate-400">
              No one has arrived yet.
            </p>
          ) : null}
        </section>

        {isHost ? (
          <>
            {gameStatus === "waiting" ? (
              <section className="rounded-3xl border border-white/5 bg-white/5 p-8 shadow-xl backdrop-blur">
                <h2 className="text-xl font-semibold text-white mb-6">Game Settings</h2>
                <div className="space-y-6">
                  <label className="flex items-center justify-between cursor-pointer">
                    <div>
                      <p className="text-base font-medium text-white">Show bounding boxes</p>
                      <p className="text-sm text-slate-400">Display person detection overlays during the match</p>
                    </div>
                    <button
                      type="button"
                      onClick={handleToggleBoundingBoxes}
                      className={`relative inline-flex h-8 w-14 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 ${
                        showBoundingBoxes ? 'bg-emerald-500' : 'bg-slate-700'
                      }`}
                      role="switch"
                      aria-checked={showBoundingBoxes}
                    >
                      <span
                        className={`pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                          showBoundingBoxes ? 'translate-x-6' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </label>
                  
                  <div>
                    <div className="mb-3">
                      <p className="text-base font-medium text-white">Game duration</p>
                      <p className="text-sm text-slate-400">How long the match will last</p>
                    </div>
                    <div className="flex gap-2">
                      {[1, 2, 3, 5, 10].map((minutes) => (
                        <button
                          key={minutes}
                          type="button"
                          onClick={() => handleGameDurationChange(minutes)}
                          className={`flex-1 px-4 py-2 rounded-lg text-sm font-semibold transition ${
                            gameDuration === minutes
                              ? 'bg-emerald-500 text-white shadow-lg'
                              : 'bg-white/10 text-slate-300 hover:bg-white/20'
                          }`}
                        >
                          {minutes} min
                        </button>
                      ))}
                    </div>
                  </div>
                  
                  {settingsError ? (
                    <p className="text-sm text-rose-300">{settingsError}</p>
                  ) : null}
                </div>
              </section>
            ) : null}
            
            <section className="flex flex-col items-center gap-6 rounded-3xl border border-dashed border-emerald-500/40 bg-emerald-500/5 p-8 text-center text-sm text-emerald-200">
              {gameStatus === "waiting" ? (
                <>
                  <p className="text-base text-emerald-100">
                    Ready to battle? Launching the match will transport every
                    player into their Pew Pew HUD.
                  </p>
                  <button
                    type="button"
                    onClick={handleStartGame}
                    disabled={isStarting}
                    className="rounded-full bg-emerald-400 px-10 py-3 text-base font-semibold uppercase tracking-[0.4em] text-emerald-950 shadow-lg shadow-emerald-500/40 transition hover:bg-emerald-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isStarting ? "Syncing..." : "Start match"}
                  </button>
                </>
              ) : (
                <p className="text-base text-emerald-100">
                  Match is live. HUDs should be active on every device.
                </p>
              )}
            </section>
          </>
        ) : (
          <section className="rounded-3xl border border-sky-500/20 bg-sky-500/5 p-8 text-center text-sm text-sky-200">
            Hang tight. The host will launch the match from their console. Your
            HUD will light up automatically.
          </section>
        )}
      </main>
    </div>
  );
}
