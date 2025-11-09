import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { WebSocketServer } from 'ws';

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || '0.0.0.0';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

/** @typedef {'player' | 'streamer'} Role */

/** @typedef {{ name: string; socket: import('ws').WebSocket }} PlayerConnection */

/** @typedef {{ streamer?: import('ws').WebSocket; streamerName?: string; players: Map<string, PlayerConnection> }} Room */

const rooms = new Map();

/**
 * @param {string} code
 * @returns {Room}
 */
function getRoom(code) {
  let room = rooms.get(code);
  if (!room) {
    room = { players: new Map() };
    rooms.set(code, room);
  }
  return room;
}

/**
 * @param {string | undefined} code
 * @param {Role | undefined} role
 * @param {string | undefined} name
 * @param {import('ws').WebSocket} socket
 */
function cleanupConnection(code, role, name, socket) {
  if (!code || !role) return;

  const room = rooms.get(code);
  if (!room) return;

  if (role === 'player' && name) {
    if (room.players.has(name)) {
      room.players.delete(name);
      if (room.streamer && room.streamer.readyState === 1) {
        room.streamer.send(JSON.stringify({ type: 'player-left', name }));
      }
    }
  }

  if (role === 'streamer' && room.streamer === socket) {
    room.streamer = undefined;
    room.streamerName = undefined;
    room.players.forEach((player) => {
      if (player.socket.readyState === 1) {
        player.socket.send(JSON.stringify({ type: 'streamer-disconnected' }));
      }
    });
  }

  if (!room.streamer && room.players.size === 0) {
    rooms.delete(code);
  }
}

/**
 * @param {import('ws').WebSocket} socket
 * @param {string} raw
 * @param {{ code?: string; name?: string; role?: Role }} state
 */
function handleMessage(socket, raw, state) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    socket.send(JSON.stringify({ type: 'error', message: 'Invalid JSON payload' }));
    return;
  }

  if (parsed.type === 'register') {
    if (state.role) {
      console.log(`[Signaling] Ignoring duplicate registration for ${state.name}`);
      return;
    }

    state.role = parsed.role;
    state.code = parsed.code.toUpperCase();
    state.name = parsed.name;

    const room = getRoom(state.code);

    if (state.role === 'streamer') {
      console.log(`[Signaling] Registering streamer "${state.name}" for game ${state.code}`);
      if (room.streamer && room.streamer !== socket) {
        console.log(`[Signaling] Rejecting streamer - already connected`);
        socket.send(
          JSON.stringify({
            type: 'error',
            message: 'Streamer already connected for this lobby.',
          }),
        );
        socket.close(1008, 'Streamer already connected');
        return;
      }
      room.streamer = socket;
      room.streamerName = state.name;
      console.log(`[Signaling] Streamer registered. Existing players: ${Array.from(room.players.keys()).join(', ')}`);
      socket.send(
        JSON.stringify({
          type: 'registered',
          role: 'streamer',
          players: Array.from(room.players.keys()),
        }),
      );
      room.players.forEach((player) => {
        if (player.socket.readyState === 1) {
          console.log(`[Signaling] Notifying player ${player.name} that streamer is ready`);
          player.socket.send(JSON.stringify({ type: 'streamer-ready' }));
        }
      });
      return;
    }

    // player registration
    console.log(`[Signaling] Registering player "${state.name}" for game ${state.code}. Streamer present: ${Boolean(room.streamer)}`);
    room.players.set(state.name, { name: state.name, socket });
    socket.send(
      JSON.stringify({
        type: 'registered',
        role: 'player',
        streamerReady: Boolean(room.streamer),
      }),
    );
    if (room.streamer && room.streamer.readyState === 1) {
      console.log(`[Signaling] Notifying streamer that player ${state.name} joined`);
      room.streamer.send(JSON.stringify({ type: 'player-joined', name: state.name }));
      socket.send(JSON.stringify({ type: 'streamer-ready' }));
    }
    return;
  }

  if (!state.role || !state.code || !state.name) {
    socket.send(
      JSON.stringify({
        type: 'error',
        message: 'Register before sending signaling messages.',
      }),
    );
    return;
  }

  const room = getRoom(state.code);

  switch (parsed.type) {
    case 'offer': {
      if (state.role !== 'player' || !room.streamer) {
        console.log(`[Signaling] Offer from ${state.name} ignored - not a player or no streamer`);
        return;
      }
      console.log(`[Signaling] Forwarding offer from player ${state.name} to streamer`);
      if (room.streamer.readyState === 1) {
        room.streamer.send(
          JSON.stringify({
            type: 'offer',
            name: state.name,
            offer: parsed.offer,
          }),
        );
      } else {
        console.log(`[Signaling] Warning: Streamer socket not open (readyState: ${room.streamer.readyState})`);
      }
      break;
    }
    case 'answer': {
      if (state.role !== 'streamer') {
        console.log(`[Signaling] Answer from ${state.name} ignored - not a streamer`);
        return;
      }
      console.log(`[Signaling] Forwarding answer from streamer to player ${parsed.name}`);
      const target = room.players.get(parsed.name);
      if (target && target.socket.readyState === 1) {
        target.socket.send(
          JSON.stringify({
            type: 'answer',
            name: parsed.name,
            answer: parsed.answer,
          }),
        );
      } else {
        console.log(`[Signaling] Warning: Target player ${parsed.name} not found or socket not open`);
      }
      break;
    }
    case 'candidate': {
      if (state.role === 'player') {
        console.log(`[Signaling] ICE candidate from player ${state.name} -> streamer`);
        if (room.streamer && room.streamer.readyState === 1) {
          room.streamer.send(
            JSON.stringify({
              type: 'candidate',
              name: state.name,
              candidate: parsed.candidate,
            }),
          );
        } else {
          console.log(`[Signaling] Warning: Streamer not available for ICE candidate from ${state.name}`);
        }
      } else if (state.role === 'streamer') {
        console.log(`[Signaling] ICE candidate from streamer -> player ${parsed.name}`);
        const target = room.players.get(parsed.name);
        if (target && target.socket.readyState === 1) {
          target.socket.send(
            JSON.stringify({
              type: 'candidate',
              name: parsed.name,
              candidate: parsed.candidate,
            }),
          );
        } else {
          console.log(`[Signaling] Warning: Player ${parsed.name} not found or socket not open`);
        }
      }
      break;
    }
    case 'leave': {
      console.log(`[Signaling] ${state.role} ${state.name} leaving game ${state.code}`);
      cleanupConnection(state.code, state.role, state.name, socket);
      break;
    }
    case 'score-update': {
      if (state.role !== 'player') {
        console.log(`[Signaling] Score update from ${state.name} ignored - not a player`);
        return;
      }
      console.log(`[Signaling] Broadcasting score update from player ${state.name} in game ${state.code}: ${parsed.score} points`);
      
      // Broadcast score update to streamer
      if (room.streamer && room.streamer.readyState === 1) {
        room.streamer.send(
          JSON.stringify({
            type: 'score-update',
            playerName: state.name,
            score: parsed.score,
            timestamp: Date.now()
          }),
        );
      }
      
      // Also broadcast to all other players in the room (for their own scoreboards if needed)
      room.players.forEach((player) => {
        if (player.name !== state.name && player.socket.readyState === 1) {
          player.socket.send(
            JSON.stringify({
              type: 'score-update',
              playerName: state.name,
              score: parsed.score,
              timestamp: Date.now()
            }),
          );
        }
      });
      break;
    }
    default:
      console.log(`[Signaling] Unknown message type: ${parsed.type} from ${state.name}`);
      break;
  }
}

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error handling request', err);
      res.statusCode = 500;
      res.end('Internal server error');
    }
  });

  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws) => {
    const state = {};
    const connectionId = Math.random().toString(36).substring(7);
    console.log(`[WS ${connectionId}] New WebSocket connection established`);

    ws.on('message', (data) => {
      const dataStr = data.toString();
      try {
        const parsed = JSON.parse(dataStr);
        console.log(`[WS ${connectionId}] Received message:`, parsed.type, {
          role: state.role || 'not-registered',
          name: state.name || 'unknown',
          code: state.code || 'none'
        });
        handleMessage(ws, dataStr, state);
      } catch (err) {
        console.error(`[WS ${connectionId}] Error handling message:`, err.message);
        handleMessage(ws, dataStr, state);
      }
    });

    ws.on('close', (code, reason) => {
      console.log(`[WS ${connectionId}] Connection closed:`, {
        code,
        reason: reason.toString(),
        role: state.role,
        name: state.name,
        gameCode: state.code
      });
      cleanupConnection(state.code, state.role, state.name, ws);
    });

    ws.on('error', (error) => {
      console.error(`[WS ${connectionId}] WebSocket error:`, {
        message: error.message,
        role: state.role,
        name: state.name,
        gameCode: state.code
      });
      cleanupConnection(state.code, state.role, state.name, ws);
    });

    ws.on('pong', () => {
      console.log(`[WS ${connectionId}] Pong received from ${state.name || 'unknown'}`);
    });
  });

  server.on('upgrade', (request, socket, head) => {
    const { pathname } = parse(request.url || '', true);
    console.log(`[WebSocket] Upgrade request to: ${pathname}`);
    if (pathname === '/api/signaling') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        console.log('[WebSocket] Connection established');
        wss.emit('connection', ws, request);
      });
    } else {
      console.log(`[WebSocket] Rejected upgrade to: ${pathname}`);
      socket.destroy();
    }
  });

  server.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});

