#!/usr/bin/env node
/* global process */
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PARTBOX_SYNC_PORT || 9000);
const HEARTBEAT_MS = 25000;
const MAX_MISSED_PONG = 2;

const wss = new WebSocketServer({ port: PORT });
const rooms = new Map();

function getRoom(roomId) {
    if (!rooms.has(roomId)) {
        rooms.set(roomId, { players: {}, gameState: null, isLocked: false });
    }
    return rooms.get(roomId);
}

function safeSend(ws, payload) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

function broadcast(roomId, payload) {
    wss.clients.forEach((client) => {
        if (client.readyState !== client.OPEN) return;
        if (client.roomId !== roomId) return;
        safeSend(client, payload);
    });
}

wss.on('connection', (ws) => {
    ws.roomId = null;
    ws.missedPongs = 0;
    ws.isAlive = true;

    ws.on('pong', () => {
        ws.missedPongs = 0;
        ws.isAlive = true;
    });

    ws.on('message', (raw) => {
        let msg;
        try {
            msg = JSON.parse(String(raw));
        } catch {
            return;
        }

        if (msg.type === 'join' && msg.roomId) {
            ws.roomId = msg.roomId;
            safeSend(ws, { type: 'snapshot', room: getRoom(msg.roomId) });
            return;
        }

        if (!ws.roomId) return;
        const room = getRoom(ws.roomId);

        if (msg.type === 'patch' && typeof msg.patch === 'object') {
            Object.assign(room, msg.patch);
            broadcast(ws.roomId, { type: 'snapshot', room });
            return;
        }

        if (msg.type === 'get') {
            safeSend(ws, { type: 'snapshot', room });
        }
    });
});

setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.readyState !== ws.OPEN) return;
        if (!ws.isAlive) {
            ws.missedPongs += 1;
        }
        if (ws.missedPongs >= MAX_MISSED_PONG) {
            ws.terminate();
            return;
        }
        ws.isAlive = false;
        ws.ping();
    });
}, HEARTBEAT_MS);

console.log(`[partbox-sync] listening on :${PORT}`);
