import OpenAIApi from 'openai';
import { getKey, hasKey } from '../utils/keys.js';
import { strictFormat } from '../utils/text.js';
import { randomUUID } from 'crypto';
import { WebSocket as UndiciWebSocket } from 'undici';

export class Qwen {
    static prefix = 'qwen';
    constructor(model_name, url, params) {
        this.model_name = model_name;
        this.params = params;
        let config = {};

        config.baseURL = url || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
        config.apiKey = getKey('QWEN_API_KEY');

        this.openai = new OpenAIApi(config);
    }

    async sendRequest(turns, systemMessage, stop_seq='***') {
        let messages = [{'role': 'system', 'content': systemMessage}].concat(turns);

        messages = strictFormat(messages);

        const pack = {
            model: this.model_name || "qwen-plus",
            messages,
            stop: stop_seq,
            ...(this.params || {})
        };

        let res = null;
        try {
            console.log('Awaiting Qwen api response...');
            // console.log('Messages:', messages);
            let completion = await this.openai.chat.completions.create(pack);
            if (completion.choices[0].finish_reason == 'length')
                throw new Error('Context length exceeded');
            console.log('Received.');
            res = completion.choices[0].message.content;
        }
        catch (err) {
            if ((err.message == 'Context length exceeded' || err.code == 'context_length_exceeded') && turns.length > 1) {
                console.log('Context length exceeded, trying again with shorter context.');
                return await this.sendRequest(turns.slice(1), systemMessage, stop_seq);
            } else {
                console.log(err);
                res = 'My brain disconnected, try again.';
            }
        }
        return res;
    }

    // Why random backoff?
    // With a 30 requests/second limit on Alibaba Qwen's embedding service,
    // random backoff helps maximize bandwidth utilization.
    async embed(text) {
        const maxRetries = 5; // Maximum number of retries
        for (let retries = 0; retries < maxRetries; retries++) {
            try {
                const { data } = await this.openai.embeddings.create({
                    model: this.model_name || "text-embedding-v3",
                    input: text,
                    encoding_format: "float",
                });
                return data[0].embedding;
            } catch (err) {
                if (err.status === 429) {
                    // If a rate limit error occurs, calculate the exponential backoff with a random delay (1-5 seconds)
                    const delay = Math.pow(2, retries) * 1000 + Math.floor(Math.random() * 2000);
                    // console.log(`Rate limit hit, retrying in ${delay} ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay)); // Wait for the delay before retrying
                } else {
                    throw err;
                }
            }
        }
        // If maximum retries are reached and the request still fails, throw an error
        throw new Error('Max retries reached, request failed.');
    }

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

async function sendRealtimeAudioRequest(text, model, voice, url, params = {}) {
    const baseUrl = getRealtimeTtsBaseUrl(url);
    const wsUrl = `${baseUrl}?model=${encodeURIComponent(model || 'qwen3-tts-flash-realtime')}`;

    return await new Promise((resolve, reject) => {
        const pcmChunks = [];
        let settled = false;
        let sessionUpdated = false;
        let responseDone = false;

        const ws = new UndiciWebSocket(wsUrl, {
            headers: {
                Authorization: `bearer ${getKey('QWEN_API_KEY')}`,
            },
        });

        const cleanup = () => {
            if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) {
                try {
                    ws.close();
                } catch {}
            }
        };

        const fail = (err) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(err);
        };

        const succeed = () => {
            if (settled) return;
            settled = true;
            cleanup();
            if (pcmChunks.length === 0) {
                reject(new Error('Qwen realtime TTS returned no audio data.'));
                return;
            }
            const pcmBuffer = Buffer.concat(pcmChunks);
            const wavHeader = createWavHeader(pcmBuffer.length, params.sample_rate || 24000, 1, 16);
            resolve(Buffer.concat([wavHeader, pcmBuffer]).toString('base64'));
        };

        const sendEvent = (type, payload = {}) => {
            ws.send(JSON.stringify({
                event_id: `event_${randomUUID()}`,
                type,
                ...payload,
            }));
        };

        ws.addEventListener('open', () => {
            const session = {
                voice: voice || params.voice || 'Cherry',
                mode: params.mode || 'commit',
                language_type: params.language_type || params.languageType || inferLanguageType(text),
                response_format: params.response_format || params.responseFormat || 'pcm',
                sample_rate: params.sample_rate || params.sampleRate || 24000,
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

        ws.addEventListener('message', (event) => {
            try {
                const message = typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8');
                const data = JSON.parse(message);
                const type = data.type;

                if (type === 'error') {
                    fail(new Error(`Qwen realtime TTS error: ${JSON.stringify(data)}`));
                    return;
                }

                if (type === 'session.updated') {
                    if (sessionUpdated) return;
                    sessionUpdated = true;
                    sendEvent('input_text_buffer.append', { text });
                    sendEvent('input_text_buffer.commit');
                    sendEvent('session.finish');
                    return;
                }

                if (type === 'response.audio.delta' && data.delta) {
                    pcmChunks.push(Buffer.from(data.delta, 'base64'));
                    return;
                }

                if (type === 'response.done') {
                    responseDone = true;
                    return;
                }

                if (type === 'session.finished') {
                    if (responseDone || pcmChunks.length > 0) {
                        succeed();
                    } else {
                        fail(new Error(`Qwen realtime TTS finished without audio: ${message}`));
                    }
                }
            } catch (err) {
                fail(err);
            }
        });

        ws.addEventListener('error', (event) => {
            fail(new Error(`Qwen realtime TTS websocket error: ${event.message || 'unknown error'}`));
        });

        ws.addEventListener('close', () => {
            if (!settled) {
                if (responseDone && pcmChunks.length > 0) {
                    succeed();
                } else {
                    fail(new Error('Qwen realtime TTS websocket closed before audio completed.'));
                }
            }
        });
    });
}

const sendAudioRequest = async (text, model, voice, url, params = {}) => {
    if (isRealtimeTtsModel(model)) {
        return sendRealtimeAudioRequest(text, model, voice, url, params);
    }

    const baseUrl = getTtsBaseUrl(url);
    const endpoint = `${baseUrl}/services/aigc/multimodal-generation/generation`;
    const requestBody = {
        model: model || 'qwen3-tts-flash',
        input: {
            text,
            voice: voice || params.voice || 'Cherry',
            language_type: params.language_type || params.languageType || inferLanguageType(text),
        }
    };

    const generationParams = { ...params };
    delete generationParams.voice;
    delete generationParams.language_type;
    delete generationParams.languageType;
    if (Object.keys(generationParams).length > 0) {
        requestBody.parameters = generationParams;
    }

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${getKey('QWEN_API_KEY')}`,
            'Content-Type': 'application/json',
            'X-DashScope-SSE': 'enable',
        },
        body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
        throw new Error(`Qwen TTS request failed (${response.status}): ${await response.text()}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/event-stream')) {
        const data = await response.json();
        const audioBase64 = data.output?.audio?.data;
        if (audioBase64) {
            return audioBase64;
        }
        throw new Error(`Qwen TTS did not return stream audio data: ${JSON.stringify(data)}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
        throw new Error('Qwen TTS response body is empty.');
    }

    const decoder = new TextDecoder();
    let pending = '';
    const pcmChunks = [];

    while (true) {
        const { value, done } = await reader.read();
        if (value) {
            pending += decoder.decode(value, { stream: !done });
            let boundaryMatch = pending.match(/\r?\n\r?\n/);
            while (boundaryMatch) {
                const boundaryIndex = boundaryMatch.index;
                const boundaryLength = boundaryMatch[0].length;
                const eventBlock = pending.slice(0, boundaryIndex);
                pending = pending.slice(boundaryIndex + boundaryLength);

                for (const line of eventBlock.split(/\r?\n/)) {
                    if (!line.startsWith('data:')) continue;
                    const payload = line.slice(5).trim();
                    if (!payload || payload === '[DONE]') continue;

                    const data = JSON.parse(payload);
                    const audioData = data.output?.audio?.data;
                    if (audioData) {
                        pcmChunks.push(Buffer.from(audioData, 'base64'));
                    }
                }

                boundaryMatch = pending.match(/\r?\n\r?\n/);
            }
        }

        if (done) break;
    }

    if (pcmChunks.length === 0) {
        throw new Error('Qwen TTS stream returned no audio data.');
    }

    const pcmBuffer = Buffer.concat(pcmChunks);
    const wavHeader = createWavHeader(pcmBuffer.length, 24000, 1, 16);
    return Buffer.concat([wavHeader, pcmBuffer]).toString('base64');
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

export const TTSConfig = {
    sendAudioRequest,
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
}
