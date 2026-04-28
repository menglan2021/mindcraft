import OpenAIApi from 'openai';
import { getKey } from '../utils/keys.js';
import { strictFormat } from '../utils/text.js';
import { randomUUID } from 'crypto';
import { WebSocket as UndiciWebSocket } from 'undici';

export class Qwen {
    static prefix = 'qwen';
    constructor(model_name, url, params) {
        this.model_name = model_name;
        this.params = params;
        const config = {
            baseURL: url || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            apiKey: getKey('QWEN_API_KEY'),
        };

        this.openai = new OpenAIApi(config);
    }

    async sendRequest(turns, systemMessage, stop_seq = '***') {
        let messages = [{ role: 'system', content: systemMessage }].concat(turns);

        messages = strictFormat(messages);

        const pack = {
            model: this.model_name || 'qwen-plus',
            messages,
            stop: stop_seq,
            ...(this.params || {}),
        };

        let res = null;
        try {
            const start = performance.now();
            console.log('Awaiting Qwen api response...');
            const completion = await this.openai.chat.completions.create(pack);
            if (completion.choices[0].finish_reason === 'length') {
                throw new Error('Context length exceeded');
            }
            console.log(`Received Qwen api response in ${((performance.now() - start) / 1000).toFixed(2)}s.`);
            res = completion.choices[0].message.content;
        } catch (err) {
            if ((err.message === 'Context length exceeded' || err.code === 'context_length_exceeded') && turns.length > 1) {
                console.log('Context length exceeded, trying again with shorter context.');
                return await this.sendRequest(turns.slice(1), systemMessage, stop_seq);
            }
            console.log(err);
            res = 'My brain disconnected, try again.';
        }
        return res;
    }

    async embed(text) {
        const maxRetries = 5;
        for (let retries = 0; retries < maxRetries; retries += 1) {
            try {
                const { data } = await this.openai.embeddings.create({
                    model: this.model_name || 'text-embedding-v3',
                    input: text,
                    encoding_format: 'float',
                });
                return data[0].embedding;
            } catch (err) {
                if (err.status === 429) {
                    const delay = Math.pow(2, retries) * 1000 + Math.floor(Math.random() * 2000);
                    await new Promise((resolve) => setTimeout(resolve, delay));
                } else {
                    throw err;
                }
            }
        }
        throw new Error('Max retries reached, request failed.');
    }
}

class AsyncChunkQueue {
    constructor() {
        this.items = [];
        this.waiters = [];
        this.error = null;
        this.done = false;
    }

    push(value) {
        if (this.done || this.error) return;
        const waiter = this.waiters.shift();
        if (waiter) {
            waiter.resolve({ value, done: false });
            return;
        }
        this.items.push(value);
    }

    finish() {
        if (this.done || this.error) return;
        this.done = true;
        while (this.waiters.length > 0) {
            this.waiters.shift().resolve({ value: undefined, done: true });
        }
    }

    fail(error) {
        if (this.done || this.error) return;
        this.error = error;
        while (this.waiters.length > 0) {
            this.waiters.shift().reject(error);
        }
    }

    async next() {
        if (this.items.length > 0) {
            return { value: this.items.shift(), done: false };
        }
        if (this.error) {
            throw this.error;
        }
        if (this.done) {
            return { value: undefined, done: true };
        }
        return await new Promise((resolve, reject) => {
            this.waiters.push({ resolve, reject });
        });
    }

    [Symbol.asyncIterator]() {
        return this;
    }
}

function createAbortError(message = 'Qwen 语音请求已取消。') {
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
}

function throwIfAborted(signal, message) {
    if (!signal?.aborted) return;
    const reason = signal.reason;
    if (reason instanceof Error) {
        throw reason;
    }
    if (typeof reason === 'string' && reason.trim() !== '') {
        throw createAbortError(reason);
    }
    throw createAbortError(message);
}

function getTtsBaseUrl(url) {
    const baseUrl = url || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    if (baseUrl.includes('/compatible-mode/v1')) {
        return baseUrl.replace(/\/compatible-mode\/v1\/?$/, '/api/v1');
    }
    if (/\/api\/v1\/?$/.test(baseUrl)) {
        return baseUrl.replace(/\/$/, '');
    }
    try {
        const parsed = new URL(baseUrl);
        return `${parsed.origin}/api/v1`;
    } catch {
        return 'https://dashscope.aliyuncs.com/api/v1';
    }
}

function inferLanguageType(text) {
    return /[\u3400-\u9fff]/.test(text) ? 'Chinese' : 'English';
}

function getRealtimeTtsBaseUrl(url) {
    const baseUrl = url || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
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

function isRealtimeTtsModel(model) {
    return typeof model === 'string' && model.includes('-realtime');
}

function getOutputSampleRate(params = {}) {
    return params.sample_rate || params.sampleRate || 24000;
}

function createWavHeader(dataLength, sampleRate, channels, bitsPerSample) {
    const header = Buffer.alloc(44);
    const byteRate = sampleRate * channels * bitsPerSample / 8;
    const blockAlign = channels * bitsPerSample / 8;

    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataLength, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataLength, 40);
    return header;
}

async function collectAudioStream(stream) {
    const chunks = [];
    for await (const chunk of stream) {
        if (chunk?.length) {
            chunks.push(Buffer.from(chunk));
        }
    }
    if (chunks.length === 0) {
        throw new Error('Qwen TTS returned no audio data.');
    }
    return Buffer.concat(chunks);
}

function streamRealtimeAudioRequest(text, model, voice, url, params = {}) {
    const signal = params.signal;
    throwIfAborted(signal);

    const baseUrl = getRealtimeTtsBaseUrl(url);
    const wsUrl = `${baseUrl}?model=${encodeURIComponent(model || 'qwen3-tts-flash-realtime')}`;
    const queue = new AsyncChunkQueue();

    let socket = null;
    let settled = false;
    let sessionUpdated = false;
    let responseDone = false;
    let sessionFinished = false;
    let receivedAudio = false;
    let firstAudioTimer = null;
    const firstAudioTimeoutMs = Number(params.first_audio_timeout_ms || params.firstAudioTimeoutMs || 20000);

    const closeSocket = () => {
        if (socket && (socket.readyState === 0 || socket.readyState === 1)) {
            try {
                socket.close();
            } catch {}
        }
    };

    const cleanup = () => {
        if (firstAudioTimer) {
            clearTimeout(firstAudioTimer);
            firstAudioTimer = null;
        }
        if (signal && abortHandler) {
            signal.removeEventListener('abort', abortHandler);
        }
    };

    const startFirstAudioTimer = () => {
        if (!Number.isFinite(firstAudioTimeoutMs) || firstAudioTimeoutMs <= 0) return;
        firstAudioTimer = setTimeout(() => {
            fail(new Error(`Qwen realtime TTS timed out before first audio chunk after ${firstAudioTimeoutMs}ms.`));
        }, firstAudioTimeoutMs);
    };

    const fail = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        closeSocket();
        queue.fail(error);
    };

    const finish = () => {
        if (settled) return;
        settled = true;
        cleanup();
        closeSocket();
        if (!receivedAudio) {
            queue.fail(new Error('Qwen realtime TTS returned no audio data.'));
            return;
        }
        queue.finish();
    };

    const sendEvent = (type, payload = {}) => {
        socket.send(JSON.stringify({
            event_id: `event_${randomUUID()}`,
            type,
            ...payload,
        }));
    };

    const abortHandler = () => {
        fail(createAbortError());
    };

    if (signal) {
        signal.addEventListener('abort', abortHandler, { once: true });
    }

    socket = new UndiciWebSocket(wsUrl, {
        headers: {
            Authorization: `Bearer ${getKey('QWEN_API_KEY')}`,
        },
    });

    socket.addEventListener('open', () => {
        startFirstAudioTimer();
        const session = {
            voice: voice || params.voice || 'Cherry',
            mode: params.mode || 'commit',
            language_type: params.language_type || params.languageType || inferLanguageType(text),
            response_format: params.response_format || params.responseFormat || 'pcm',
            sample_rate: getOutputSampleRate(params),
        };

        if (params.instructions) {
            session.instructions = params.instructions;
        }
        if (params.optimize_instructions !== undefined) {
            session.optimize_instructions = params.optimize_instructions;
        } else if (params.optimizeInstructions !== undefined) {
            session.optimize_instructions = params.optimizeInstructions;
        }

        sendEvent('session.update', { session });
    });

    socket.addEventListener('message', (event) => {
        if (settled) return;
        try {
            const message = typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8');
            const data = JSON.parse(message);

            if (data.type === 'error') {
                fail(new Error(`Qwen realtime TTS error: ${JSON.stringify(data)}`));
                return;
            }

            if (data.type === 'session.updated') {
                if (sessionUpdated) return;
                sessionUpdated = true;
                sendEvent('input_text_buffer.append', { text });
                sendEvent('input_text_buffer.commit');
                sendEvent('session.finish');
                return;
            }

            if (data.type === 'response.audio.delta' && data.delta) {
                if (!receivedAudio && firstAudioTimer) {
                    clearTimeout(firstAudioTimer);
                    firstAudioTimer = null;
                }
                receivedAudio = true;
                queue.push(Buffer.from(data.delta, 'base64'));
                return;
            }

            if (data.type === 'response.done') {
                responseDone = true;
                return;
            }

            if (data.type === 'session.finished') {
                sessionFinished = true;
                finish();
            }
        } catch (error) {
            fail(error);
        }
    });

    socket.addEventListener('error', (event) => {
        fail(new Error(`Qwen realtime TTS websocket error: ${event.message || 'unknown error'}`));
    });

    socket.addEventListener('close', () => {
        if (settled) return;
        if ((responseDone || sessionFinished) && receivedAudio) {
            finish();
        } else {
            fail(new Error('Qwen realtime TTS websocket closed before audio completed.'));
        }
    });

    return queue;
}

async function* streamStandardAudioRequest(text, model, voice, url, params = {}) {
    const signal = params.signal;
    throwIfAborted(signal);

    const baseUrl = getTtsBaseUrl(url);
    const endpoint = `${baseUrl}/services/aigc/multimodal-generation/generation`;
    const requestBody = {
        model: model || 'qwen3-tts-flash',
        input: {
            text,
            voice: voice || params.voice || 'Cherry',
            language_type: params.language_type || params.languageType || inferLanguageType(text),
        },
    };

    const generationParams = { ...params };
    delete generationParams.signal;
    delete generationParams.voice;
    delete generationParams.language_type;
    delete generationParams.languageType;
    if (Object.keys(generationParams).length > 0) {
        requestBody.parameters = generationParams;
    }

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${getKey('QWEN_API_KEY')}`,
            'Content-Type': 'application/json',
            'X-DashScope-SSE': 'enable',
        },
        body: JSON.stringify(requestBody),
        signal,
    });

    if (!response.ok) {
        throw new Error(`Qwen TTS request failed (${response.status}): ${await response.text()}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/event-stream')) {
        const data = await response.json();
        const audioBase64 = data.output?.audio?.data;
        if (!audioBase64) {
            throw new Error(`Qwen TTS did not return audio data: ${JSON.stringify(data)}`);
        }
        yield Buffer.from(audioBase64, 'base64');
        return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
        throw new Error('Qwen TTS response body is empty.');
    }

    const decoder = new TextDecoder();
    let pending = '';

    const processBlock = async function* (block) {
        for (const line of block.split(/\r?\n/)) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;

            const data = JSON.parse(payload);
            const audioData = data.output?.audio?.data;
            if (audioData) {
                yield Buffer.from(audioData, 'base64');
            }
        }
    };

    try {
        while (true) {
            throwIfAborted(signal);
            const { value, done } = await reader.read();

            if (value) {
                pending += decoder.decode(value, { stream: !done });
                let boundaryMatch = pending.match(/\r?\n\r?\n/);
                while (boundaryMatch) {
                    const boundaryIndex = boundaryMatch.index;
                    const boundaryLength = boundaryMatch[0].length;
                    const eventBlock = pending.slice(0, boundaryIndex);
                    pending = pending.slice(boundaryIndex + boundaryLength);
                    for await (const chunk of processBlock(eventBlock)) {
                        yield chunk;
                    }
                    boundaryMatch = pending.match(/\r?\n\r?\n/);
                }
            }

            if (done) break;
        }

        if (pending.trim() !== '') {
            for await (const chunk of processBlock(pending)) {
                yield chunk;
            }
        }
    } finally {
        try {
            reader.releaseLock();
        } catch {}
    }
}

function streamAudioRequest(text, model, voice, url, params = {}) {
    if (isRealtimeTtsModel(model)) {
        return streamRealtimeAudioRequest(text, model, voice, url, params);
    }
    return streamStandardAudioRequest(text, model, voice, url, params);
}

const sendAudioRequest = async (text, model, voice, url, params = {}) => {
    const sampleRate = getOutputSampleRate(params);
    const pcmBuffer = await collectAudioStream(streamAudioRequest(text, model, voice, url, params));
    const wavHeader = createWavHeader(pcmBuffer.length, sampleRate, 1, 16);
    return Buffer.concat([wavHeader, pcmBuffer]).toString('base64');
};

export const TTSConfig = {
    sendAudioRequest,
    streamAudioRequest,
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
};
