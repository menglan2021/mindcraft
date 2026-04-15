import { WebSocket as UndiciWebSocket } from 'undici';
import { isAbortError, StreamQueue } from './stream_queue.js';
import {
    buildBridgeUrl,
    createEchoChatMessage,
    createRegisterBotMessage,
    normalizeVoiceInputConfig,
} from './bridge_protocol.js';
import { transcribePcm16Audio } from './transcription.js';

const OPEN = 1;
const CONNECTING = 0;
const RECONNECT_DELAY_MS = 1500;

function normalizeTranscript(text) {
    return String(text || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[^\p{L}\p{N}]+/gu, '');
}

export class VoiceInputBridge {
    constructor(agent, globalSettings = {}) {
        this.agent = agent;
        this.globalSettings = globalSettings;
        this.profile = agent?.prompter?.profile || globalSettings.profile || {};
        this.config = normalizeVoiceInputConfig(globalSettings, this.profile);
        this.url = buildBridgeUrl(this.config);
        this.socket = null;
        this.connectPromise = null;
        this.reconnectTimer = null;
        this.running = false;
        this.inputQueue = new StreamQueue('voice-input');
        this.recentTranscripts = new Map();
    }

    async start() {
        if (!this.config.enabled || this.running) {
            return;
        }
        this.running = true;
        try {
            await this.ensureConnected();
        } catch (error) {
            console.error('[VoiceInput] initial bridge connection failed', error);
            this.#scheduleReconnect();
        }
    }

    close() {
        this.running = false;
        this.inputQueue.cancelAll('voice input bridge closed');
        this.#clearReconnectTimer();
        if (this.socket && (this.socket.readyState === OPEN || this.socket.readyState === CONNECTING)) {
            try {
                this.socket.close();
            } catch {}
        }
        this.socket = null;
        this.connectPromise = null;
    }

    async ensureConnected() {
        if (!this.config.enabled) {
            return;
        }
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

            socket.addEventListener('open', async () => {
                try {
                    this.socket = socket;
                    await this.send(this.#createRegisterMessage(), { skipEnsureConnected: true });
                    cleanup();
                    console.log(`[VoiceInput] bridge connected ${this.url}`);
                    resolve();
                } catch (error) {
                    cleanup();
                    reject(error);
                }
            });

            socket.addEventListener('message', (event) => {
                this.#handleMessage(event);
            });

            socket.addEventListener('close', () => {
                if (this.socket === socket) {
                    this.socket = null;
                }
                if (!settled) {
                    cleanup();
                    reject(new Error(`[VoiceInput] bridge closed before ready: ${this.url}`));
                }
                this.#scheduleReconnect();
            });

            socket.addEventListener('error', (event) => {
                const error = new Error(`[VoiceInput] bridge websocket error: ${event.message || 'unknown error'}`);
                if (this.socket === socket) {
                    this.socket = null;
                }
                if (!settled) {
                    cleanup();
                    reject(error);
                } else {
                    console.error(error);
                    this.#scheduleReconnect();
                }
            });
        });

        return this.connectPromise;
    }

    async send(message, options = {}) {
        if (!options.skipEnsureConnected) {
            await this.ensureConnected();
        }
        const socket = this.socket;
        if (!socket || socket.readyState !== OPEN) {
            throw new Error(`[VoiceInput] bridge is not connected: ${this.url}`);
        }
        socket.send(JSON.stringify(message));
    }

    #createRegisterMessage() {
        return createRegisterBotMessage({
            bot: this.config.botEntityName,
            echoToChat: this.config.echoToChat,
            endSilenceMs: this.config.endSilenceMs,
            minDurationMs: this.config.minDurationMs,
            maxDurationMs: this.config.maxDurationMs,
            triggerCooldownMs: this.config.triggerCooldownMs,
        });
    }

    #handleMessage(event) {
        try {
            const raw = typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8');
            const data = JSON.parse(raw);
            if (data.type === 'ack') {
                return;
            }
            if (data.type === 'error') {
                console.error(`[VoiceInput] bridge error ${data.code || 'UNKNOWN'}: ${data.message || raw}`);
                return;
            }
            if (data.type === 'input_audio') {
                this.#queueInputAudio(data);
                return;
            }
            console.log('[VoiceInput] bridge message', raw);
        } catch (error) {
            console.warn('[VoiceInput] failed to parse bridge message', error);
        }
    }

    #queueInputAudio(data) {
        this.inputQueue.enqueue(async ({ signal }) => {
            const transcript = await this.#transcribeIncomingAudio(data, signal);
            if (!transcript) {
                return;
            }
            if (this.#isDuplicateTranscript(data.player, transcript)) {
                console.log(`[VoiceInput] duplicate transcript ignored from ${data.player}: ${transcript}`);
                return;
            }
            if (this.config.echoToChat) {
                try {
                    await this.send(createEchoChatMessage({
                        utteranceId: data.utteranceId,
                        speaker: data.player,
                        targetBot: data.targetBot || this.config.botEntityName,
                        text: transcript,
                    }));
                } catch (error) {
                    console.error('[VoiceInput] failed to echo transcript to chat', error);
                }
            }
            console.log(`[VoiceInput] transcript ${data.player} -> ${transcript}`);
            await this.agent.respondFunc?.(data.player, transcript);
        }).catch((error) => {
            if (!isAbortError(error)) {
                console.error('[VoiceInput] failed to handle input audio', error);
            }
        });
    }

    async #transcribeIncomingAudio(data, signal) {
        const pcm16leBase64 = data?.pcm16le_base64;
        if (!pcm16leBase64) {
            return '';
        }

        const pcm16leBuffer = Buffer.from(pcm16leBase64, 'base64');
        if (pcm16leBuffer.length === 0) {
            return '';
        }

        const transcript = await transcribePcm16Audio({
            pcm16leBuffer,
            sampleRate: Number(data.sampleRate) || 48000,
            channels: Number(data.channels) || 1,
            modelConfig: this.#resolveSttModelConfig(),
            language: this.config.language,
            prompt: this.config.prompt,
            signal,
        });

        return String(transcript || '').trim();
    }

    #resolveSttModelConfig() {
        if (typeof this.config.sttModel === 'string') {
            if (this.config.sttUrl) {
                const [provider, ...rest] = this.config.sttModel.split('/');
                if (rest.length > 0) {
                    return {
                        api: provider,
                        model: rest.join('/'),
                        url: this.config.sttUrl,
                    };
                }
                return {
                    api: 'openai',
                    model: this.config.sttModel,
                    url: this.config.sttUrl,
                };
            }
            return this.config.sttModel;
        }
        return {
            ...(this.config.sttModel || {}),
            ...(this.config.sttUrl ? { url: this.config.sttUrl } : {}),
        };
    }

    #isDuplicateTranscript(player, transcript) {
        const normalized = normalizeTranscript(transcript);
        if (!normalized) {
            return true;
        }

        const key = `${player}:${normalized}`;
        const now = Date.now();
        const recent = this.recentTranscripts.get(key);
        const duplicateWindowMs = Math.max(2000, this.config.triggerCooldownMs * 2);
        if (recent && (now - recent) < duplicateWindowMs) {
            return true;
        }
        this.recentTranscripts.set(key, now);

        for (const [entryKey, timestamp] of this.recentTranscripts.entries()) {
            if ((now - timestamp) > 30000) {
                this.recentTranscripts.delete(entryKey);
            }
        }

        return false;
    }

    #scheduleReconnect() {
        if (!this.running || this.reconnectTimer) {
            return;
        }
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.ensureConnected().catch((error) => {
                console.error('[VoiceInput] reconnect failed', error);
                this.#scheduleReconnect();
            });
        }, RECONNECT_DELAY_MS);
        if (typeof this.reconnectTimer.unref === 'function') {
            this.reconnectTimer.unref();
        }
    }

    #clearReconnectTimer() {
        if (!this.reconnectTimer) {
            return;
        }
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
    }
}
