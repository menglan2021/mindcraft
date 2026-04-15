import { WebSocket as UndiciWebSocket } from 'undici';
import {
    buildBridgeUrl,
    createCancelMessage,
    createChunkMessage,
    createEndMessage,
    createPingMessage,
    createStartMessage,
} from './bridge_protocol.js';

const clients = new Map();
const OPEN = 1;
const CONNECTING = 0;

class VoiceBridgeClient {
    constructor(config) {
        this.config = { ...config };
        this.url = buildBridgeUrl(config);
        this.socket = null;
        this.connectPromise = null;
        this.pingTimer = null;
    }

    async ensureConnected() {
        if (this.socket?.readyState === OPEN) {
            return;
        }
        if (this.connectPromise) {
            return this.connectPromise;
        }

        this.connectPromise = new Promise((resolve, reject) => {
            const socket = new UndiciWebSocket(this.url);
            let settled = false;

            const cleanup = () => {
                if (settled) return;
                settled = true;
                this.connectPromise = null;
            };

            socket.addEventListener('open', () => {
                this.socket = socket;
                this.#startPingLoop();
                cleanup();
                resolve();
            });

            socket.addEventListener('message', (event) => {
                this.#handleMessage(event);
            });

            socket.addEventListener('close', () => {
                this.#stopPingLoop();
                if (this.socket === socket) {
                    this.socket = null;
                }
                if (!settled) {
                    cleanup();
                    reject(new Error(`[TTS] bridge closed before ready: ${this.url}`));
                }
            });

            socket.addEventListener('error', (event) => {
                const error = new Error(`[TTS] bridge websocket error: ${event.message || 'unknown error'}`);
                this.#stopPingLoop();
                if (this.socket === socket) {
                    this.socket = null;
                }
                if (!settled) {
                    cleanup();
                    reject(error);
                } else {
                    console.error(error);
                }
            });
        });

        return this.connectPromise;
    }

    async startUtterance(payload) {
        await this.send(createStartMessage(payload));
    }

    async sendChunk(payload) {
        await this.send(createChunkMessage(payload));
    }

    async endUtterance(utteranceId) {
        await this.send(createEndMessage({ utteranceId }));
    }

    async cancelUtterance(utteranceId) {
        await this.send(createCancelMessage({ utteranceId }));
    }

    async send(message) {
        await this.ensureConnected();
        const socket = this.socket;
        if (!socket || socket.readyState !== OPEN) {
            throw new Error(`[TTS] bridge is not connected: ${this.url}`);
        }
        socket.send(JSON.stringify(message));
    }

    close() {
        this.#stopPingLoop();
        if (this.socket && (this.socket.readyState === OPEN || this.socket.readyState === CONNECTING)) {
            try {
                this.socket.close();
            } catch {}
        }
        this.socket = null;
        this.connectPromise = null;
    }

    #handleMessage(event) {
        try {
            const raw = typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8');
            const data = JSON.parse(raw);
            if (data.type === 'error') {
                console.error(`[TTS] bridge error ${data.code || 'UNKNOWN'}: ${data.message || raw}`);
                return;
            }
            if (data.type === 'ack') {
                return;
            }
            console.log('[TTS] bridge message', raw);
        } catch (error) {
            console.warn('[TTS] failed to parse bridge message', error);
        }
    }

    #startPingLoop() {
        this.#stopPingLoop();
        this.pingTimer = setInterval(() => {
            const socket = this.socket;
            if (!socket || socket.readyState !== OPEN) {
                return;
            }
            try {
                socket.send(JSON.stringify(createPingMessage()));
            } catch (error) {
                console.error('[TTS] bridge ping failed', error);
            }
        }, 15000);
        if (typeof this.pingTimer.unref === 'function') {
            this.pingTimer.unref();
        }
    }

    #stopPingLoop() {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }
    }
}

export function getBridgeClient(config) {
    const url = buildBridgeUrl(config);
    if (!clients.has(url)) {
        clients.set(url, new VoiceBridgeClient(config));
    }
    return clients.get(url);
}

export function closeAllBridgeClients() {
    for (const client of clients.values()) {
        client.close();
    }
    clients.clear();
}
