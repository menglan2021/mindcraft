import { randomUUID } from 'crypto';
import { WebSocket as UndiciWebSocket } from 'undici';
import { getKey } from '../utils/keys.js';

const OPEN = 1;
const CONNECTING = 0;
const DEFAULT_REALTIME_ASR_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DEFAULT_REALTIME_ASR_MODEL = 'qwen3-asr-flash-realtime';
const TARGET_SAMPLE_RATE = 16000;
const DEFAULT_READY_TIMEOUT_MS = 5000;
const DEFAULT_FINISH_TIMEOUT_MS = 5000;

function getRealtimeBaseUrl(url) {
    const baseUrl = url || DEFAULT_REALTIME_ASR_URL;
    if (baseUrl.includes('/compatible-mode/v1')) {
        return baseUrl.replace(/\/compatible-mode\/v1\/?$/, '/api-ws/v1/realtime');
    }
    if (baseUrl.includes('/api/v1')) {
        return baseUrl.replace(/\/api\/v1\/?$/, '/api-ws/v1/realtime');
    }
    try {
        const parsed = new URL(baseUrl);
        return `${parsed.origin}/api-ws/v1/realtime`;
    } catch {
        return 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime';
    }
}

function resolveRealtimeAsrModel(modelConfig, fallbackUrl = '') {
    if (typeof modelConfig === 'string') {
        const [provider, ...rest] = modelConfig.split('/');
        if (rest.length > 0) {
            return {
                provider,
                model: rest.join('/'),
                url: fallbackUrl,
                keyName: provider === 'qwen' ? 'QWEN_API_KEY' : null,
                params: {},
            };
        }
        return {
            provider: modelConfig.includes('qwen') ? 'qwen' : 'openai',
            model: modelConfig,
            url: fallbackUrl,
            keyName: 'QWEN_API_KEY',
            params: {},
        };
    }

    return {
        provider: modelConfig?.api || 'qwen',
        model: modelConfig?.model || DEFAULT_REALTIME_ASR_MODEL,
        url: modelConfig?.url || fallbackUrl,
        keyName: modelConfig?.key_name || modelConfig?.keyName || modelConfig?.params?.key_name || modelConfig?.params?.keyName || 'QWEN_API_KEY',
        params: modelConfig?.params || {},
    };
}

function downsamplePcm16Mono(buffer, inputSampleRate) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) return Buffer.alloc(0);
    const sampleRate = Number(inputSampleRate);
    if (sampleRate === TARGET_SAMPLE_RATE) return Buffer.from(buffer);
    if (sampleRate <= 0 || sampleRate % TARGET_SAMPLE_RATE !== 0) {
        throw new Error(`实时 ASR 当前仅支持 ${TARGET_SAMPLE_RATE}Hz 的整数倍降采样，收到 ${sampleRate}`);
    }

    const ratio = sampleRate / TARGET_SAMPLE_RATE;
    const inputSamples = Math.floor(buffer.length / 2);
    const outputSamples = Math.floor(inputSamples / ratio);
    const output = Buffer.alloc(outputSamples * 2);

    for (let outIndex = 0; outIndex < outputSamples; outIndex += 1) {
        const start = Math.floor(outIndex * ratio);
        const end = Math.floor((outIndex + 1) * ratio);
        let sum = 0;
        let count = 0;
        for (let inIndex = start; inIndex < end && inIndex < inputSamples; inIndex += 1) {
            sum += buffer.readInt16LE(inIndex * 2);
            count += 1;
        }
        output.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sum / Math.max(1, count)))), outIndex * 2);
    }

    return output;
}

function getNumberParam(params, names, fallback) {
    for (const name of names) {
        if (params?.[name] === undefined || params?.[name] === null || params?.[name] === '') continue;
        const value = Number(params[name]);
        if (Number.isFinite(value)) return value;
    }
    return fallback;
}

function normalizeLanguage(language) {
    const normalized = String(language || '').trim().toLowerCase();
    if (!normalized || normalized === 'auto' || normalized === 'detect') {
        return '';
    }
    return normalized;
}

export function isRealtimeAsrModel(modelConfig) {
    const resolved = resolveRealtimeAsrModel(modelConfig);
    return resolved.provider === 'qwen' && String(resolved.model || '').includes('-realtime');
}

export class RealtimeAsrSession {
    constructor({
        utteranceId,
        player,
        targetBot,
        sampleRate,
        channels = 1,
        modelConfig,
        sttUrl = '',
        language = 'en',
        onTranscript,
        onError,
    }) {
        this.utteranceId = utteranceId;
        this.player = player;
        this.targetBot = targetBot;
        this.sampleRate = Number(sampleRate) || 48000;
        this.channels = Number(channels) || 1;
        this.language = language;
        this.onTranscript = onTranscript;
        this.onError = onError;
        this.resolved = resolveRealtimeAsrModel(modelConfig, sttUrl);
        this.socket = null;
        this.readyPromise = null;
        this.closed = false;
        this.completed = false;
        this.failed = false;
        this.readyTimer = null;
        this.finishTimer = null;
        this.startedAt = performance.now();
        this.pending = Promise.resolve();
    }

    async start() {
        if (this.channels !== 1) {
            throw new Error(`实时 ASR 当前仅支持单声道，收到 channels=${this.channels}`);
        }
        if (this.readyPromise) return this.readyPromise;

        const wsUrl = `${getRealtimeBaseUrl(this.resolved.url)}?model=${encodeURIComponent(this.resolved.model || DEFAULT_REALTIME_ASR_MODEL)}`;
        this.readyPromise = new Promise((resolve, reject) => {
            const socket = new UndiciWebSocket(wsUrl, {
                headers: {
                    Authorization: `Bearer ${getKey(this.resolved.keyName || 'QWEN_API_KEY')}`,
                },
            });
            this.socket = socket;
            const readyTimeoutMs = getNumberParam(
                this.resolved.params,
                ['ready_timeout_ms', 'readyTimeoutMs'],
                DEFAULT_READY_TIMEOUT_MS,
            );
            if (readyTimeoutMs > 0) {
                this.readyTimer = setTimeout(() => {
                    const error = new Error(`Qwen realtime ASR timed out waiting for session.updated after ${readyTimeoutMs}ms.`);
                    this.#fail(error);
                    reject(error);
                }, readyTimeoutMs);
            }

            socket.addEventListener('open', () => {
                const inputAudioTranscription = {};
                const language = normalizeLanguage(this.language);
                if (language) {
                    inputAudioTranscription.language = language;
                }
                this.#send('session.update', {
                    session: {
                        modalities: ['text'],
                        input_audio_format: 'pcm',
                        sample_rate: TARGET_SAMPLE_RATE,
                        input_audio_transcription: inputAudioTranscription,
                        turn_detection: {
                            type: 'server_vad',
                            threshold: this.resolved.params?.vad_threshold ?? 0.3,
                            silence_duration_ms: this.resolved.params?.vad_silence_duration_ms ?? 700,
                        },
                    },
                });
            });

            socket.addEventListener('message', (event) => {
                try {
                    const raw = typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8');
                    this.#handleMessage(JSON.parse(raw), resolve, reject);
                } catch (error) {
                    this.#fail(error);
                }
            });

            socket.addEventListener('error', () => {
                const error = new Error('Qwen realtime ASR websocket error');
                this.#fail(error);
                reject(error);
            });

            socket.addEventListener('close', () => {
                this.closed = true;
                if (!this.completed && !this.failed && this.readyTimer) {
                    const error = new Error('Qwen realtime ASR websocket closed before ready.');
                    this.#fail(error);
                    reject(error);
                }
            });
        });

        return this.readyPromise;
    }

    async appendPcmChunk(pcm16le) {
        this.pending = this.pending.then(() => this.#appendPcmChunkNow(pcm16le));
        return this.pending;
    }

    async #appendPcmChunkNow(pcm16le) {
        if (this.completed || this.closed) return;
        await this.start();
        const downsampled = downsamplePcm16Mono(Buffer.from(pcm16le), this.sampleRate);
        if (downsampled.length === 0) return;
        this.#send('input_audio_buffer.append', {
            audio: downsampled.toString('base64'),
        });
    }

    async finish({ dropOnly = false } = {}) {
        if (this.closed) return;
        if (dropOnly) {
            this.close();
            return;
        }
        await this.pending;
        await this.start();
        this.#send('session.finish');
        this.#startFinishTimer();
    }

    close() {
        if (this.socket && (this.socket.readyState === OPEN || this.socket.readyState === CONNECTING)) {
            try {
                this.socket.close();
            } catch {}
        }
        this.closed = true;
        this.#cleanupTimers();
    }

    #send(type, payload = {}) {
        if (!this.socket || this.socket.readyState !== OPEN) return;
        this.socket.send(JSON.stringify({
            event_id: `event_${randomUUID()}`,
            type,
            ...payload,
        }));
    }

    #handleMessage(data, resolve, reject) {
        if (data.type === 'session.updated' || data.type === 'session.created') {
            if (data.type === 'session.updated') {
                if (this.readyTimer) {
                    clearTimeout(this.readyTimer);
                    this.readyTimer = null;
                }
                console.log(`[VoiceInput] realtime ASR ready utteranceId=${this.utteranceId}`);
                resolve();
            }
            return;
        }

        if (data.type === 'error' || data.error) {
            const error = new Error(`Qwen realtime ASR error: ${JSON.stringify(data)}`);
            this.#fail(error);
            reject?.(error);
            return;
        }

        if (data.type === 'conversation.item.input_audio_transcription.text') {
            const preview = `${data.text || ''}${data.stash || ''}`.trim();
            if (preview) {
                console.log(`[VoiceInput] realtime partial ${this.player}: ${preview}`);
            }
            return;
        }

        if (data.type === 'conversation.item.input_audio_transcription.completed') {
            this.#complete(data.transcript || '');
            return;
        }

        if (data.type === 'conversation.item.input_audio_transcription.failed') {
            const error = new Error(`Qwen realtime ASR transcription failed: ${JSON.stringify(data.error || data)}`);
            this.#fail(error);
            reject?.(error);
            return;
        }

        if (data.type === 'session.finished' && !this.completed) {
            this.#fail(new Error('Qwen realtime ASR finished without a final transcript.'));
        }
    }

    #complete(text) {
        const transcript = String(text || '').trim();
        if (this.completed) return;
        if (!transcript) {
            this.#fail(new Error('Qwen realtime ASR completed with an empty transcript.'));
            return;
        }
        this.completed = true;
        this.#cleanupTimers();
        console.log(`[VoiceInputTiming] realtime_asr utteranceId=${this.utteranceId} elapsed=${((performance.now() - this.startedAt) / 1000).toFixed(2)}s`);
        this.onTranscript?.({
            utteranceId: this.utteranceId,
            player: this.player,
            targetBot: this.targetBot,
            transcript,
        });
        this.close();
    }

    #startFinishTimer() {
        if (this.finishTimer) return;
        const finishTimeoutMs = getNumberParam(
            this.resolved.params,
            ['finish_timeout_ms', 'finishTimeoutMs'],
            DEFAULT_FINISH_TIMEOUT_MS,
        );
        if (!Number.isFinite(finishTimeoutMs) || finishTimeoutMs <= 0) return;
        this.finishTimer = setTimeout(() => {
            this.#fail(new Error(`Qwen realtime ASR timed out waiting for final transcript after ${finishTimeoutMs}ms.`));
        }, finishTimeoutMs);
    }

    #cleanupTimers() {
        if (this.readyTimer) {
            clearTimeout(this.readyTimer);
            this.readyTimer = null;
        }
        if (this.finishTimer) {
            clearTimeout(this.finishTimer);
            this.finishTimer = null;
        }
    }

    #fail(error) {
        if (this.failed || this.completed) return;
        this.failed = true;
        this.#cleanupTimers();
        this.onError?.(error);
        this.close();
    }
}
