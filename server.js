const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { WebSocketServer } = require('ws');

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
    if (state.role) return;

    state.role = parsed.role;
    state.code = parsed.code.toUpperCase();
    state.name = parsed.name;

    const room = getRoom(state.code);

    if (state.role === 'streamer') {
      if (room.streamer && room.streamer !== socket) {
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
      socket.send(
        JSON.stringify({
          type: 'registered',
          role: 'streamer',
          players: Array.from(room.players.keys()),
        }),
      );
      room.players.forEach((player) => {
        if (player.socket.readyState === 1) {
          player.socket.send(JSON.stringify({ type: 'streamer-ready' }));
        }
      });
      return;
    }

    // player registration
    room.players.set(state.name, { name: state.name, socket });
    socket.send(
      JSON.stringify({
        type: 'registered',
        role: 'player',
        streamerReady: Boolean(room.streamer),
      }),
    );
    if (room.streamer && room.streamer.readyState === 1) {
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
      if (state.role !== 'player' || !room.streamer) return;
      if (room.streamer.readyState === 1) {
        room.streamer.send(
          JSON.stringify({
            type: 'offer',
            name: state.name,
            offer: parsed.offer,
          }),
        );
      }
      break;
    }
    case 'answer': {
      if (state.role !== 'streamer') return;
      const target = room.players.get(parsed.name);
      if (target && target.socket.readyState === 1) {
        target.socket.send(
          JSON.stringify({
            type: 'answer',
            name: parsed.name,
            answer: parsed.answer,
          }),
        );
      }
      break;
    }
    case 'candidate': {
      if (state.role === 'player') {
        if (room.streamer && room.streamer.readyState === 1) {
          room.streamer.send(
            JSON.stringify({
              type: 'candidate',
              name: state.name,
              candidate: parsed.candidate,
            }),
          );
        }
      } else if (state.role === 'streamer') {
        const target = room.players.get(parsed.name);
        if (target && target.socket.readyState === 1) {
          target.socket.send(
            JSON.stringify({
              type: 'candidate',
              name: parsed.name,
              candidate: parsed.candidate,
            }),
          );
        }
      }
      break;
    }
    case 'leave': {
      cleanupConnection(state.code, state.role, state.name, socket);
      break;
    }
    default:
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

    ws.on('message', (data) => {
      handleMessage(ws, data.toString(), state);
    });

    ws.on('close', () => {
      cleanupConnection(state.code, state.role, state.name, ws);
    });

    ws.on('error', () => {
      cleanupConnection(state.code, state.role, state.name, ws);
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

