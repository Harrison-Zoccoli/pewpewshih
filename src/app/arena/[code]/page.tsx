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

  // Poll game state to get settings and scores
  useEffect(() => {
    const pollGame = async () => {
      try {
        const res = await fetch(`/api/game/${code}`);
        const data = await res.json();
        setGame(data);
        
        // Update player's score
        const player = data.players?.find(
          (p: any) => p.name.toLowerCase() === playerName.toLowerCase()
        );
        if (player) {
          setPlayerScore(player.score);
        }
      } catch (err) {
        console.error("Failed to fetch game state", err);
      }
    };
    
    pollGame();
    const interval = setInterval(pollGame, 3000);
    
    return () => clearInterval(interval);
  }, [code, playerName]);

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
    if (!code || !playerName) {
      return;
    }

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
      sendMessage({ type: "leave", code, name: playerName });
      wsRef.current?.close();
      wsRef.current = null;
      pcRef.current?.close();
      pcRef.current = null;
    };
  }, [code, playerName, sendMessage]);

  useEffect(() => {
    if (!streamerReady || !localStreamRef.current) {
      return;
    }

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
  }, [startStreaming, streamerReady]);

  // Handle hits from CameraFeed
  const handleHit = useCallback(async (targetColor: { r: number; g: number; b: number }) => {
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
          setPlayerScore(player.score);
        }
      }
    } catch (err) {
      console.error("Failed to register hit", err);
    }
  }, [code, playerName]);

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
      <main className="relative flex flex-1 flex-col items-center justify-center px-6 pb-32">
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
      <footer className="sticky bottom-0 flex justify-center bg-gradient-to-t from-black/80 via-black/60 to-transparent pb-10 pt-6">
        <button
          type="button"
          onClick={() => {
            // Trigger a click on the canvas
            const canvas = canvasRef.current;
            if (canvas) {
              canvas.click();
            }
          }}
          className="relative flex h-20 w-56 items-center justify-center rounded-full bg-gradient-to-r from-rose-500 via-fuchsia-500 to-sky-500 text-lg font-bold uppercase tracking-[0.6em] text-white shadow-[0_0_40px_rgba(236,72,153,0.5)] transition hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-rose-200"
        >
          Fire
          <span className="absolute inset-1 rounded-full border border-white/20" />
        </button>
      </footer>
    </div>
  );
}
