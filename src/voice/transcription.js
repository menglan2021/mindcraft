import OpenAIApi, { toFile } from 'openai';
import { getKey, hasKey } from '../utils/keys.js';

const DEFAULT_OPENAI_STT_URL = 'https://api.openai.com/v1';
const DEFAULT_QWEN_STT_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DEFAULT_OPENAI_STT_MODEL = 'gpt-4o-mini-transcribe';
const DEFAULT_QWEN_STT_MODEL = 'qwen3-asr-flash';
const QWEN_WAVE_FILLER_SIZE = 4044;

function inferProvider(modelConfig) {
    if (typeof modelConfig === 'string') {
        const [maybeProvider, ...rest] = modelConfig.split('/');
        if (rest.length > 0) {
            return {
                provider: maybeProvider,
                model: rest.join('/'),
                url: '',
                params: {},
            };
        }
        return {
            provider: maybeProvider.includes('qwen') ? 'qwen' : 'openai',
            model: modelConfig,
            url: '',
            params: {},
        };
    }

    const provider = modelConfig?.api || 'openai';
    const defaultModel = provider === 'qwen' ? DEFAULT_QWEN_STT_MODEL : DEFAULT_OPENAI_STT_MODEL;

    return {
        provider,
        model: modelConfig?.model || defaultModel,
        url: modelConfig?.url || '',
        params: modelConfig?.params || {},
    };
}

function getApiKey(provider) {
    const keyName = provider === 'qwen' ? 'QWEN_API_KEY' : 'OPENAI_API_KEY';
    return getKey(keyName);
}

function getBaseUrl(provider, overrideUrl = '') {
    if (overrideUrl && overrideUrl.trim() !== '') {
        return overrideUrl;
    }
    if (provider === 'qwen') {
        return DEFAULT_QWEN_STT_URL;
    }
    return DEFAULT_OPENAI_STT_URL;
}

function createWaveBuffer(pcm16leBuffer, sampleRate, channels = 1, bitsPerSample = 16, fillerChunkSize = 0) {
    const pcmBuffer = Buffer.isBuffer(pcm16leBuffer) ? pcm16leBuffer : Buffer.from(pcm16leBuffer);
    const dataLength = pcmBuffer.length;
    const blockAlign = channels * (bitsPerSample / 8);
    const byteRate = sampleRate * blockAlign;
    const prefix = Buffer.alloc(36);

    prefix.write('RIFF', 0);
    prefix.writeUInt32LE(4 + (8 + 16) + (fillerChunkSize > 0 ? 8 + fillerChunkSize : 0) + (8 + dataLength), 4);
    prefix.write('WAVE', 8);
    prefix.write('fmt ', 12);
    prefix.writeUInt32LE(16, 16);
    prefix.writeUInt16LE(1, 20);
    prefix.writeUInt16LE(channels, 22);
    prefix.writeUInt32LE(sampleRate, 24);
    prefix.writeUInt32LE(byteRate, 28);
    prefix.writeUInt16LE(blockAlign, 32);
    prefix.writeUInt16LE(bitsPerSample, 34);

    const chunks = [prefix];
    if (fillerChunkSize > 0) {
        const fillerHeader = Buffer.alloc(8);
        fillerHeader.write('FLLR', 0);
        fillerHeader.writeUInt32LE(fillerChunkSize, 4);
        chunks.push(fillerHeader, Buffer.alloc(fillerChunkSize));
    }

    const dataHeader = Buffer.alloc(8);
    dataHeader.write('data', 0);
    dataHeader.writeUInt32LE(dataLength, 4);
    chunks.push(dataHeader, pcmBuffer);

    return Buffer.concat(chunks);
}

export function createPcm16WaveBuffer(pcm16leBuffer, sampleRate, channels = 1) {
    return createWaveBuffer(pcm16leBuffer, sampleRate, channels);
}

function createQwenWaveDataUri(pcm16leBuffer, sampleRate, channels = 1) {
    const wavBuffer = createWaveBuffer(pcm16leBuffer, sampleRate, channels, 16, QWEN_WAVE_FILLER_SIZE);
    return `data:audio/wav;base64,${wavBuffer.toString('base64')}`;
}

function extractChatCompletionText(completion) {
    const content = completion?.choices?.[0]?.message?.content;
    if (typeof content === 'string') {
        return content.trim();
    }
    if (Array.isArray(content)) {
        return content
            .map((part) => {
                if (typeof part === 'string') {
                    return part;
                }
                if (part?.type === 'text') {
                    return part.text || '';
                }
                return '';
            })
            .join('')
            .trim();
    }
    return '';
}

async function transcribeWithQwen({
    client,
    pcm16leBuffer,
    sampleRate,
    channels,
    model,
    language,
    params,
    signal,
}) {
    const extraBody = {
        ...(params?.extra_body || {}),
        asr_options: {
            enable_itn: false,
            ...(language ? { language } : {}),
            ...(params?.extra_body?.asr_options || {}),
        },
    };

    const messages = [{
        role: 'user',
        content: [
            {
                type: 'input_audio',
                input_audio: {
                    data: createQwenWaveDataUri(pcm16leBuffer, sampleRate, channels),
                },
            },
        ],
    }];

    const response = await client.chat.completions.create(
        {
            model,
            messages,
            stream: false,
            extra_body: extraBody,
        },
        signal ? { signal } : undefined
    );

    return extractChatCompletionText(response);
}

export async function transcribePcm16Audio({
    pcm16leBuffer,
    sampleRate,
    channels = 1,
    modelConfig = 'qwen/qwen3-asr-flash',
    language = 'zh',
    prompt = '',
    signal,
}) {
    const resolved = inferProvider(modelConfig);
    if (!['openai', 'qwen'].includes(resolved.provider)) {
        throw new Error(`当前语音转写仅支持 openai 或 qwen，收到 provider=${resolved.provider}`);
    }

    const config = {
        apiKey: getApiKey(resolved.provider),
        baseURL: getBaseUrl(resolved.provider, resolved.url),
    };
    if (resolved.provider === 'openai' && hasKey('OPENAI_ORG_ID')) {
        config.organization = getKey('OPENAI_ORG_ID');
    }

    const client = new OpenAIApi(config);
    if (resolved.provider === 'qwen') {
        return transcribeWithQwen({
            client,
            pcm16leBuffer,
            sampleRate,
            channels,
            model: resolved.model,
            language,
            params: resolved.params || {},
            signal,
        });
    }

    const wavBuffer = createPcm16WaveBuffer(pcm16leBuffer, sampleRate, channels);
    const file = await toFile(wavBuffer, 'voice-input.wav', { type: 'audio/wav' });

    const payload = {
        file,
        model: resolved.model,
        language,
        ...(prompt ? { prompt } : {}),
        ...(resolved.params || {}),
    };

    const response = await client.audio.transcriptions.create(payload, signal ? { signal } : undefined);
    if (typeof response === 'string') {
        return response.trim();
    }
    return String(response?.text || '').trim();
}
