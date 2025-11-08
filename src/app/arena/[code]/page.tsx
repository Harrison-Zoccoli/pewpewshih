'use client';

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CameraFeed from "@/components/CameraFeed";
import type { PublicGame } from "@/lib/gameStore";

type OutboundMessage =
  | { type: "register"; code: string; name: string; role: "player" }
  | { type: "offer"; code: string; name: string; offer: RTCSessionDescriptionInit }
  | {
      type: "candidate";
      code: string;
      name: string;
      candidate: RTCIceCandidateInit;
    }
  | { type: "leave"; code: string; name: string };

type InboundMessage =
  | { type: "registered"; role: "player"; streamerReady?: boolean }
  | { type: "streamer-ready" }
  | { type: "streamer-disconnected" }
  | { type: "answer"; name: string; answer: RTCSessionDescriptionInit }
  | { type: "candidate"; name: string; candidate: RTCIceCandidateInit }
  | { type: "error"; message: string };

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
];

export default function ArenaPage() {
  const params = useParams<{ code: string }>();
  const searchParams = useSearchParams();

  const code = (params.code ?? "").toUpperCase();
  const playerName = searchParams.get("name") ?? "";
  const isHost = searchParams.get("host") === "1";

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [signalingStatus, setSignalingStatus] = useState<string | null>(null);
  const [streamerReady, setStreamerReady] = useState(false);
  const [game, setGame] = useState<PublicGame | null>(null);
  const [playerScore, setPlayerScore] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  
  // Ammo and gun state
  const [gun1Ammo, setGun1Ammo] = useState(10);
  const [gun2Ammo, setGun2Ammo] = useState(3);
  const [selectedGun, setSelectedGun] = useState<1 | 2>(1);

  // Poll game state to get settings and scores (but not ammo - handled client-side)
  useEffect(() => {
    const pollGame = async () => {
      try {
        const res = await fetch(`/api/game/${code}`);
        const data = await res.json();
        setGame(data);
        
        // Update player's score and selected gun, but NOT ammo
        // (ammo is managed client-side to avoid race conditions with regeneration)
        const player = data.players?.find(
          (p: any) => p.name.toLowerCase() === playerName.toLowerCase()
        );
        if (player) {
          setPlayerScore(player.score);
          setSelectedGun(player.selectedGun);
          
          // Only log server ammo for debugging, don't sync it
          console.log(`[Ammo] Server sync - Gun1: ${player.gun1Ammo}, Gun2: ${player.gun2Ammo} (not applied to local state)`);
        }
      } catch (err) {
        console.error("Failed to fetch game state", err);
      }
    };
    
    pollGame();
    const interval = setInterval(pollGame, 3000);
    
    return () => clearInterval(interval);
  }, [code, playerName]);

  // Ammo regeneration - Gun 1: 1 bullet per second, Gun 2: 1 bullet per 3 seconds (slower reload)
  useEffect(() => {
    console.log('[Ammo] Regeneration timers started');
    
    const gun1Interval = setInterval(() => {
      setGun1Ammo((prev) => {
        const newAmmo = Math.min(10, prev + 1);
        if (newAmmo !== prev) {
          console.log(`[Ammo] Gun 1 regenerated: ${prev} -> ${newAmmo}`);
        }
        return newAmmo;
      });
    }, 1000); // 1 bullet per second (10 seconds for full reload)

    const gun2Interval = setInterval(() => {
      setGun2Ammo((prev) => {
        const newAmmo = Math.min(3, prev + 1);
        if (newAmmo !== prev) {
          console.log(`[Ammo] Gun 2 regenerated: ${prev} -> ${newAmmo}`);
        }
        return newAmmo;
      });
    }, 3000); // 1 bullet per 3 seconds (9 seconds for full reload)
    
    return () => {
      console.log('[Ammo] Regeneration timers cleared');
      clearInterval(gun1Interval);
      clearInterval(gun2Interval);
    };
  }, []);

  // Set up canvas streaming for WebRTC once canvas is ready
  useEffect(() => {
    if (!cameraReady || !canvasRef.current) {
      return;
    }

    try {
      // Capture the canvas as a MediaStream for WebRTC
      const canvas = canvasRef.current;
      const stream = canvas.captureStream(30); // 30 FPS
      localStreamRef.current = stream;
      setIsStreaming(true);
      console.log('Canvas stream captured for WebRTC');
    } catch (err) {
      console.error('Failed to capture canvas stream:', err);
      setStreamError('Unable to stream canvas to control booth.');
    }
  }, [cameraReady]);

  const sendMessage = useCallback((message: OutboundMessage) => {
    const socket = wsRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }, []);

  const createPeerConnection = useCallback(async () => {
    if (pcRef.current) {
      return pcRef.current;
    }
    const stream = localStreamRef.current;
    if (!stream) {
      return null;
    }

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;

    stream.getTracks().forEach((track) => {
      pc.addTrack(track, stream);
    });

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

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === "connected") {
        setSignalingStatus("Streaming to control booth");
      } else if (state === "connecting") {
        setSignalingStatus("Connecting to control booth...");
      } else if (state === "failed") {
        setSignalingStatus("Connection failed. Retrying when booth is ready.");
      } else if (state === "disconnected") {
        setSignalingStatus("Disconnected from control booth.");
      }
    };

    return pc;
  }, [code, playerName, sendMessage]);

  const startStreaming = useCallback(async () => {
    const pc = await createPeerConnection();
    if (!pc) {
      return;
    }

    try {
      const offer = await pc.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false });
      await pc.setLocalDescription(offer);
      setSignalingStatus("Awaiting control booth response...");
      sendMessage({ type: "offer", code, name: playerName, offer });
    } catch (error) {
      setSignalingStatus("Unable to initiate stream. Retrying soon.");
      console.error("Failed to create offer", error);
    }
  }, [code, createPeerConnection, playerName, sendMessage]);

  useEffect(() => {
    // CRITICAL FIX: Don't connect WebSocket until we have a stream ready!
    if (!code || !playerName || !localStreamRef.current) {
      console.log('[Arena] Waiting for stream before connecting WebSocket...', {
        code: !!code,
        playerName: !!playerName,
        stream: !!localStreamRef.current
      });
      return;
    }

    console.log('[Arena] Stream ready, establishing WebSocket connection for', playerName);

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const wsUrl = `${protocol}://${window.location.host}/api/signaling`;

    const ensureServerAndConnect = async () => {
      try {
        await fetch("/api/signaling");
      } catch (error) {
        console.warn("Unable to warm up signaling endpoint", error);
      }

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[Arena] WebSocket opened for', playerName);
        setSignalingStatus("Contacting control booth...");
        sendMessage({ type: "register", code, name: playerName, role: "player" });
        // ensure server is ready for offers once streamer joins
      };

      ws.onmessage = async (event) => {
        let payload: InboundMessage;
        try {
          payload = JSON.parse(event.data);
        } catch (error) {
          console.error("Invalid message", error);
          return;
        }

        switch (payload.type) {
          case "registered": {
            if (payload.streamerReady) {
              setStreamerReady(true);
            }
            break;
          }
          case "streamer-ready": {
            setStreamerReady(true);
            break;
          }
          case "streamer-disconnected": {
            setStreamerReady(false);
            setSignalingStatus("Waiting for control booth to reconnect...");
            break;
          }
          case "answer": {
            if (pcRef.current) {
              await pcRef.current.setRemoteDescription(new RTCSessionDescription(payload.answer));
              setSignalingStatus("Control booth connected.");
            }
            break;
          }
          case "candidate": {
            if (pcRef.current && payload.candidate) {
              try {
                await pcRef.current.addIceCandidate(new RTCIceCandidate(payload.candidate));
              } catch (error) {
                console.error("Failed to add ICE candidate", error);
              }
            }
            break;
          }
          case "error": {
            setSignalingStatus(payload.message);
            break;
          }
          default:
            break;
        }
      };

      ws.onerror = () => {
        setSignalingStatus("Signaling connection error. Retrying soon...");
      };

      ws.onclose = () => {
        setSignalingStatus("Signaling connection closed.");
        wsRef.current = null;
        pcRef.current?.close();
        pcRef.current = null;
      };
    };

    void ensureServerAndConnect();

    return () => {
      console.log('[Arena] Cleaning up WebSocket for', playerName);
      sendMessage({ type: "leave", code, name: playerName });
      wsRef.current?.close();
      wsRef.current = null;
      pcRef.current?.close();
      pcRef.current = null;
    };
  }, [code, playerName, sendMessage, isStreaming]); // Added isStreaming to trigger when stream is ready

  useEffect(() => {
    if (!streamerReady || !localStreamRef.current) {
      console.log('[Arena] Not starting stream yet...', {
        streamerReady,
        hasStream: !!localStreamRef.current,
        playerName
      });
      return;
    }

    console.log('[Arena] Starting WebRTC streaming for', playerName);

    let cancelled = false;

    const run = async () => {
      if (!cancelled) {
        await startStreaming();
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [startStreaming, streamerReady, playerName]);

  // Handle gun switching
  const handleSwitchGun = useCallback(async (gunNumber: 1 | 2) => {
    if (gunNumber === selectedGun) {
      console.log(`[Ammo] Already on Gun ${gunNumber}`);
      return;
    }
    
    console.log(`[Ammo] === SWITCHING GUNS ===`);
    console.log(`[Ammo] From: Gun ${selectedGun} -> To: Gun ${gunNumber}`);
    console.log(`[Ammo] Current ammo - Gun1: ${gun1Ammo}, Gun2: ${gun2Ammo}`);
    
    try {
      setSelectedGun(gunNumber);
      console.log(`[Ammo] Selected gun updated to Gun ${gunNumber}`);
      
      await fetch(`/api/game/${code}/gun`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerName, gunNumber }),
      });
      
      console.log(`[Ammo] Server notified of gun switch to Gun ${gunNumber}`);
    } catch (err) {
      console.error("[Ammo] Failed to switch gun:", err);
    }
  }, [code, playerName, selectedGun, gun1Ammo, gun2Ammo]);

  // Handle shots from CameraFeed - called on every Fire button press
  const handleHit = useCallback(async (didHit: boolean, targetColor?: { r: number; g: number; b: number }) => {
    const currentAmmo = selectedGun === 1 ? gun1Ammo : gun2Ammo;
    const currentGun = selectedGun;
    
    console.log(`[Ammo] Firing Gun ${currentGun} - Current ammo: ${currentAmmo} - Hit: ${didHit}`);
    
    // Check ammo BEFORE consuming
    if (currentAmmo <= 0) {
      console.log(`[Ammo] No ammo in Gun ${currentGun}! Shot blocked.`);
      return;
    }
    
    // ALWAYS consume ammo when firing, regardless of hit/miss
    if (currentGun === 1) {
      setGun1Ammo((prev) => {
        const newAmmo = Math.max(0, prev - 1);
        console.log(`[Ammo] Gun 1 fired: ${prev} -> ${newAmmo}`);
        return newAmmo;
      });
    } else {
      setGun2Ammo((prev) => {
        const newAmmo = Math.max(0, prev - 1);
        console.log(`[Ammo] Gun 2 fired: ${prev} -> ${newAmmo}`);
        return newAmmo;
      });
    }
    
    // If we hit someone, award points
    if (didHit && targetColor) {
      try {
        const res = await fetch(`/api/game/${code}/hit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playerName, targetColor }),
        });
        
        if (res.ok) {
          const data = await res.json();
          const player = data.players?.find(
            (p: any) => p.name.toLowerCase() === playerName.toLowerCase()
          );
          if (player) {
            console.log(`[Ammo] Hit confirmed! Score: ${player.score}`);
            setPlayerScore(player.score);
          }
        } else {
          const errorData = await res.json();
          console.log(`[Ammo] Hit failed to register: ${errorData.error}`);
        }
      } catch (err) {
        console.error("[Ammo] Failed to register hit:", err);
      }
    } else {
      console.log(`[Ammo] Missed! No target hit.`);
    }
  }, [code, playerName, selectedGun, gun1Ammo, gun2Ammo]);

  const statusMessage = useMemo(() => {
    if (streamError) return streamError;
    if (signalingStatus) return signalingStatus;
    if (isStreaming) return "Camera feed online. Ready to engage.";
    return "Requesting camera access...";
  }, [isStreaming, signalingStatus, streamError]);

  const lobbySearch = useMemo(() => {
    const params = new URLSearchParams();
    if (playerName) {
      params.set("name", playerName);
    }
    if (isHost) {
      params.set("host", "1");
    }
    const query = params.toString();
    return query ? `?${query}` : "";
  }, [isHost, playerName]);

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-slate-950 via-slate-900 to-black text-slate-100">
      <header className="flex items-center justify-between px-6 py-5">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-slate-400">
            Pew Pew Arena
          </p>
          <h1 className="text-2xl font-bold text-white">
            {playerName || (isHost ? "Host" : "Player")}
          </h1>
          <p className="mt-1 text-xs uppercase tracking-[0.4em] text-slate-500">
            Lobby {code}
          </p>
        </div>
        <Link
          href={`/lobby/${code}${lobbySearch}`}
          className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-300 hover:text-white"
        >
          Back to lobby
        </Link>
      </header>
      <main className="relative flex flex-1 flex-col items-center justify-center px-6 pb-8">
        <div className="relative w-full max-w-4xl overflow-hidden rounded-[2.5rem] border border-white/10 bg-black/40 shadow-2xl">
          {/* MediaPipe CameraFeed with person detection */}
          <CameraFeed
            onHit={handleHit}
            showBoundingBoxes={game?.settings?.showBoundingBoxes ?? true}
            isActive={true}
            canvasRef={canvasRef}
            onCameraReady={() => setCameraReady(true)}
          />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-6 text-sm text-slate-200">
            {statusMessage}
          </div>
        </div>
      </main>
      <footer className="sticky bottom-0 flex flex-col items-center gap-4 bg-gradient-to-t from-black/80 via-black/60 to-transparent pb-10 pt-6 px-6">
        {/* Ammo and Gun Controls */}
        <div className="flex items-center gap-6">
          {/* Gun selector buttons */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleSwitchGun(1)}
              className={`relative flex h-14 w-14 items-center justify-center rounded-xl border-2 text-xl font-bold transition ${
                selectedGun === 1
                  ? 'border-cyan-400 bg-cyan-500/20 text-cyan-200 shadow-[0_0_20px_rgba(34,211,238,0.4)]'
                  : 'border-white/20 bg-black/40 text-slate-400 hover:border-white/40'
              }`}
            >
              1
            </button>
            <button
              type="button"
              onClick={() => handleSwitchGun(2)}
              className={`relative flex h-14 w-14 items-center justify-center rounded-xl border-2 text-xl font-bold transition ${
                selectedGun === 2
                  ? 'border-rose-400 bg-rose-500/20 text-rose-200 shadow-[0_0_20px_rgba(244,63,94,0.4)]'
                  : 'border-white/20 bg-black/40 text-slate-400 hover:border-white/40'
              }`}
            >
              2
            </button>
          </div>

          {/* Ammo display */}
          <div className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-black/60 px-4 py-3 backdrop-blur">
            {/* Gun 1 ammo */}
            <div className={`flex items-center gap-2 ${selectedGun === 1 ? 'opacity-100' : 'opacity-50'}`}>
              <div className="text-[0.65rem] font-semibold text-cyan-300 w-12">GUN 1</div>
              <div className="flex gap-1">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div
                    key={i}
                    className={`h-2 w-2 rounded-full transition-all ${
                      i < gun1Ammo ? 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.6)]' : 'bg-slate-700'
                    }`}
                  />
                ))}
              </div>
              <div className="text-sm font-bold text-cyan-200 w-6 text-right">{gun1Ammo}</div>
            </div>
            
            {/* Gun 2 ammo */}
            <div className={`flex items-center gap-2 ${selectedGun === 2 ? 'opacity-100' : 'opacity-50'}`}>
              <div className="text-[0.65rem] font-semibold text-rose-300 w-12">GUN 2</div>
              <div className="flex gap-1.5">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className={`h-3 w-3 rounded-full transition-all ${
                      i < gun2Ammo ? 'bg-rose-400 shadow-[0_0_8px_rgba(244,63,94,0.6)]' : 'bg-slate-700'
                    }`}
                  />
                ))}
              </div>
              <div className="text-sm font-bold text-rose-200 w-6 text-right">{gun2Ammo}</div>
            </div>
          </div>
        </div>

        {/* Fire button */}
        <button
          type="button"
          onClick={() => {
            const currentAmmo = selectedGun === 1 ? gun1Ammo : gun2Ammo;
            if (currentAmmo <= 0) return;
            
            // Trigger a click on the canvas
            const canvas = canvasRef.current;
            if (canvas) {
              canvas.click();
            }
          }}
          disabled={(selectedGun === 1 ? gun1Ammo : gun2Ammo) <= 0}
          className={`relative flex h-20 w-56 items-center justify-center rounded-full text-lg font-bold uppercase tracking-[0.6em] text-white shadow-[0_0_40px_rgba(236,72,153,0.5)] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-rose-200 ${
            (selectedGun === 1 ? gun1Ammo : gun2Ammo) <= 0
              ? 'bg-gradient-to-r from-slate-600 to-slate-700 opacity-50 cursor-not-allowed'
              : 'bg-gradient-to-r from-rose-500 via-fuchsia-500 to-sky-500 hover:scale-105'
          }`}
        >
          Fire
          <span className="absolute inset-1 rounded-full border border-white/20" />
        </button>
      </footer>
    </div>
  );
}
