import { exec, spawn } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import settings from './settings.js';
import { TTSConfig as gptTTSConfig } from '../models/gpt.js';
import { TTSConfig as geminiTTSConfig } from '../models/gemini.js';
import { TTSConfig as qwenTTSConfig } from '../models/qwen.js';
import { PcmAudioFrameChunker } from '../voice/audio_frame.js';
import { getBridgeClient } from '../voice/bridge_client.js';
import {
    createUtteranceId,
    getVoiceOutputMode,
    normalizeVoiceBridgeConfig,
} from '../voice/bridge_protocol.js';
import { Pcm16MonoResampler } from '../voice/pcm_resampler.js';
import { StreamQueue, createAbortError, isAbortError, throwIfAborted } from '../voice/stream_queue.js';

const speakingQueue = new StreamQueue('tts');

function getProviderConfig(provider) {
    if (provider === 'openai') return gptTTSConfig;
    if (provider === 'google') return geminiTTSConfig;
    if (provider === 'qwen') return qwenTTSConfig;
    return null;
}

function resolveSpeechModel(model) {
    if (typeof model === 'string') {
        const [provider, modelName, voice] = model.split('/');
        const providerConfig = getProviderConfig(provider);
        return {
            provider,
            modelName,
            voice,
            url: providerConfig?.baseUrl,
            params: {},
            providerConfig,
        };
    }

    const provider = model.api;
    const providerConfig = getProviderConfig(provider);
    return {
        provider,
        modelName: model.model,
        voice: model.voice,
        url: model.url || providerConfig?.baseUrl,
        params: {
            ...(model.params || {}),
            ...(model.key_name ? { key_name: model.key_name } : {}),
            ...(model.keyName ? { keyName: model.keyName } : {}),
        },
        providerConfig,
    };
}

function detectAudioExtension(audioBuffer) {
    if (audioBuffer.length >= 12 && audioBuffer.subarray(0, 4).toString() === 'RIFF') {
        return 'wav';
    }
    if (audioBuffer.length >= 3 && audioBuffer.subarray(0, 3).toString() === 'ID3') {
        return 'mp3';
    }
    if (audioBuffer.length >= 2 && audioBuffer[0] === 0xff && (audioBuffer[1] & 0xe0) === 0xe0) {
        return 'mp3';
    }
    return 'mp3';
}

function inferRemoteSampleRate(provider, params = {}) {
    if (params.sample_rate || params.sampleRate) {
        return Number(params.sample_rate || params.sampleRate);
    }
    if (provider === 'qwen' || provider === 'google') {
        return 24000;
    }
    return null;
}

function parsePcmWave(audioBuffer) {
    if (audioBuffer.length < 44 || audioBuffer.subarray(0, 4).toString() !== 'RIFF' || audioBuffer.subarray(8, 12).toString() !== 'WAVE') {
        return null;
    }

    let offset = 12;
    let sampleRate = null;
    let channels = null;
    let bitsPerSample = null;
    let audioFormat = null;
    let dataOffset = null;
    let dataLength = null;

    while (offset + 8 <= audioBuffer.length) {
        const chunkId = audioBuffer.subarray(offset, offset + 4).toString();
        const chunkSize = audioBuffer.readUInt32LE(offset + 4);
        const chunkStart = offset + 8;

        if (chunkId === 'fmt ') {
            audioFormat = audioBuffer.readUInt16LE(chunkStart);
            channels = audioBuffer.readUInt16LE(chunkStart + 2);
            sampleRate = audioBuffer.readUInt32LE(chunkStart + 4);
            bitsPerSample = audioBuffer.readUInt16LE(chunkStart + 14);
        } else if (chunkId === 'data') {
            dataOffset = chunkStart;
            dataLength = chunkSize;
            break;
        }

        offset = chunkStart + chunkSize + (chunkSize % 2);
    }

    if (audioFormat !== 1 || channels !== 1 || bitsPerSample !== 16 || dataOffset === null || dataLength === null) {
        return null;
    }

    return {
        sampleRate,
        channels,
        pcmData: Buffer.from(audioBuffer.subarray(dataOffset, dataOffset + dataLength)),
    };
}

function createLinkedAbortController(parentSignal) {
    const controller = new AbortController();
    let abortHandler = null;

    if (parentSignal) {
        if (parentSignal.aborted) {
            controller.abort(parentSignal.reason || createAbortError('语音任务已取消。'));
        } else {
            abortHandler = () => {
                controller.abort(parentSignal.reason || createAbortError('语音任务已取消。'));
            };
            parentSignal.addEventListener('abort', abortHandler, { once: true });
        }
    }

    return {
        controller,
        unlink() {
            if (parentSignal && abortHandler) {
                parentSignal.removeEventListener('abort', abortHandler);
            }
        },
    };
}

async function fetchRemoteAudio(text, model, signal) {
    const resolved = resolveSpeechModel(model);
    if (!resolved.providerConfig) {
        throw new Error(`TTS Provider ${resolved.provider} is not supported.`);
    }
    throwIfAborted(signal, '语音请求已取消。');
    return resolved.providerConfig.sendAudioRequest(
        text,
        resolved.modelName,
        resolved.voice,
        resolved.url,
        { ...resolved.params, signal },
    );
}

function buildSystemSpeakCommand(text) {
    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';

    if (isWin) {
        return `powershell -NoProfile -Command "Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate=2; $s.Speak('${text.replace(/'/g, "''")}'); $s.Dispose()"`;
    }
    if (isMac) {
        return `say "${text.replace(/"/g, '\\"')}"`;
    }
    return `espeak "${text.replace(/"/g, '\\"')}"`;
}

function waitForChild(child, { signal, onAbort, onFinally } = {}) {
    return new Promise((resolve, reject) => {
        let settled = false;

        const cleanup = async (error = null) => {
            if (settled) return;
            settled = true;
            if (signal && abortHandler) {
                signal.removeEventListener('abort', abortHandler);
            }
            try {
                await onFinally?.();
            } catch {}
            if (error) {
                reject(error);
            } else {
                resolve();
            }
        };

        const abortHandler = () => {
            try {
                onAbort?.();
            } catch {}
            cleanup(signal.reason instanceof Error ? signal.reason : createAbortError('语音播放已取消。'));
        };

        if (signal) {
            if (signal.aborted) {
                abortHandler();
                return;
            }
            signal.addEventListener('abort', abortHandler, { once: true });
        }

        child.on('error', (error) => {
            cleanup(error);
        });

        child.on('exit', (code, exitSignal) => {
            if (signal?.aborted) {
                cleanup(signal.reason instanceof Error ? signal.reason : createAbortError('语音播放已取消。'));
                return;
            }
            if (code && code !== 0) {
                cleanup(new Error(`语音播放器退出异常：code=${code}, signal=${exitSignal || 'none'}`));
                return;
            }
            cleanup();
        });
    });
}

async function playSystemSpeech(text, signal) {
    throwIfAborted(signal, '系统语音已取消。');
    const child = exec(buildSystemSpeakCommand(text));
    await waitForChild(child, {
        signal,
        onAbort: () => child.kill(),
    });
}

async function playBufferedAudio(audioBuffer, signal) {
    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';

    if (isWin) {
        const ext = detectAudioExtension(audioBuffer);
        const tmpPath = path.join(os.tmpdir(), `tts_${Date.now()}.${ext}`);
        await fs.writeFile(tmpPath, audioBuffer);

        const player = spawn('ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet', tmpPath], {
            stdio: 'ignore',
            windowsHide: true,
        });
        await waitForChild(player, {
            signal,
            onAbort: () => player.kill(),
            onFinally: async () => {
                try {
                    await fs.unlink(tmpPath);
                } catch {}
            },
        });
        return;
    }

    if (isMac) {
        const ext = detectAudioExtension(audioBuffer);
        const tmpPath = path.join(os.tmpdir(), `tts_${Date.now()}.${ext}`);
        await fs.writeFile(tmpPath, audioBuffer);

        const player = spawn('afplay', [tmpPath], {
            stdio: 'ignore',
        });
        await waitForChild(player, {
            signal,
            onAbort: () => player.kill(),
            onFinally: async () => {
                try {
                    await fs.unlink(tmpPath);
                } catch {}
            },
        });
        return;
    }

    const player = spawn('ffplay', ['-nodisp', '-autoexit', 'pipe:0'], {
        stdio: ['pipe', 'ignore', 'ignore'],
    });
    player.stdin.write(audioBuffer);
    player.stdin.end();
    await waitForChild(player, {
        signal,
        onAbort: () => player.kill(),
    });
}

async function playLocalAudio(text, model, signal) {
    const audioData = await fetchRemoteAudio(text, model, signal);
    if (!audioData) {
        throw new Error('[TTS] No audio data ready');
    }
    throwIfAborted(signal, '本地语音播放已取消。');
    const audioBuffer = Buffer.from(audioData, 'base64');
    await playBufferedAudio(audioBuffer, signal);
}

async function sendBridgeFrames(iterable, sourceSampleRate, bridgeConfig, bridgeClient, utteranceId, signal) {
    if (bridgeConfig.channels !== 1) {
        throw new Error(`当前仅支持单声道语音桥接，收到 channels=${bridgeConfig.channels}`);
    }

    const resampler = new Pcm16MonoResampler({
        inputSampleRate: sourceSampleRate,
        outputSampleRate: bridgeConfig.sampleRate,
    });
    const frameChunker = new PcmAudioFrameChunker({
        sampleRate: bridgeConfig.sampleRate,
        channels: bridgeConfig.channels,
        frameDurationMs: bridgeConfig.frameDurationMs,
    });

    let seq = 1;
    let loggedChunk = false;

    const flushFrames = async (frames) => {
        for (const frame of frames) {
            throwIfAborted(signal, '语音桥接发送已取消。');
            await bridgeClient.sendChunk({
                utteranceId,
                seq,
                pcm16le: frame,
            });
            if (!loggedChunk) {
                console.log(`[TTS] bridge chunk utteranceId=${utteranceId} seq=${seq} bytes=${frame.length}`);
                loggedChunk = true;
            }
            seq += 1;
        }
    };

    for await (const chunk of iterable) {
        throwIfAborted(signal, '语音桥接发送已取消。');
        if (!chunk || chunk.length === 0) continue;
        await flushFrames(frameChunker.push(resampler.push(Buffer.from(chunk))));
    }

    await flushFrames(frameChunker.push(resampler.flush()));
    await flushFrames(frameChunker.flush());
}

async function playMinecraftVoiceChat(text, model, options, signal) {
    const profile = options.profile || settings.profile || {};
    const bridgeConfig = normalizeVoiceBridgeConfig(settings, profile);

    if (!bridgeConfig.enabled) {
        console.warn('[TTS] voice bridge disabled, fallback to local player');
        await playLocalAudio(text, model, signal);
        return;
    }

    const resolved = resolveSpeechModel(model);
    if (!resolved.providerConfig) {
        throw new Error(`TTS Provider ${resolved.provider} is not supported.`);
    }

    const utteranceId = createUtteranceId(bridgeConfig.botEntityName);
    const bridgeClient = getBridgeClient(bridgeConfig);
    await bridgeClient.ensureConnected();
    console.log(`[TTS] bridge connected ${bridgeClient.url}`);

    await bridgeClient.startUtterance({
        utteranceId,
        bot: bridgeConfig.botEntityName,
        sampleRate: bridgeConfig.sampleRate,
        channels: bridgeConfig.channels,
    });
    console.log(`[TTS] bridge start utteranceId=${utteranceId} bot=${bridgeConfig.botEntityName}`);
    console.log(`[TTS] requesting audio provider=${resolved.provider} model=${resolved.modelName || 'default'} streaming=${bridgeConfig.streaming}`);

    const linkedAbort = createLinkedAbortController(signal);

    try {
        if (bridgeConfig.streaming && typeof resolved.providerConfig.streamAudioRequest === 'function') {
            const sourceSampleRate = inferRemoteSampleRate(resolved.provider, resolved.params);
            if (!sourceSampleRate) {
                throw new Error(`无法推断 ${resolved.provider} 的流式采样率。`);
            }
            const audioStream = resolved.providerConfig.streamAudioRequest(
                text,
                resolved.modelName,
                resolved.voice,
                resolved.url,
                { ...resolved.params, signal: linkedAbort.controller.signal },
            );
            await sendBridgeFrames(audioStream, sourceSampleRate, bridgeConfig, bridgeClient, utteranceId, signal);
        } else {
            const audioData = await fetchRemoteAudio(text, model, signal);
            const audioBuffer = Buffer.from(audioData, 'base64');
            const wave = parsePcmWave(audioBuffer);
            if (!wave) {
                throw new Error('桥接模式要求 PCM WAV 音频，但当前提供者返回的格式无法直接解析。');
            }
            await sendBridgeFrames([wave.pcmData], wave.sampleRate, bridgeConfig, bridgeClient, utteranceId, signal);
        }

        await bridgeClient.endUtterance(utteranceId);
        console.log(`[TTS] bridge end utteranceId=${utteranceId}`);
    } catch (error) {
        if (!linkedAbort.controller.signal.aborted) {
            linkedAbort.controller.abort(error instanceof Error ? error : createAbortError('语音桥接失败。'));
        }
        try {
            await bridgeClient.cancelUtterance(utteranceId);
            console.log(`[TTS] bridge cancel utteranceId=${utteranceId}`);
        } catch (cancelError) {
            console.error('[TTS] failed to cancel bridge utterance', cancelError);
        }
        throw error;
    } finally {
        linkedAbort.unlink();
    }
}

async function performSpeech(text, model, options, signal) {
    const profile = options.profile || settings.profile || {};
    const outputMode = getVoiceOutputMode(settings, profile);

    if (model === 'system' || outputMode === 'system') {
        await playSystemSpeech(text, signal);
        return;
    }

    if (outputMode === 'minecraft_voicechat') {
        await playMinecraftVoiceChat(text, model, options, signal);
        return;
    }

    await playLocalAudio(text, model, signal);
}

export function speak(text, speakModel, options = {}) {
    if (!text || text.trim() === '') {
        return Promise.resolve(null);
    }

    const model = speakModel || 'system';
    return speakingQueue.enqueue(async ({ signal }) => {
        await performSpeech(text, model, options, signal);
    }).catch((error) => {
        if (!isAbortError(error)) {
            console.error('[TTS] speech failed', error);
        }
        return null;
    });
}

export function cancelSpeech(message = '语音播放已取消。') {
    speakingQueue.cancelAll(message);
}

export async function waitForSpeechIdle() {
    await speakingQueue.waitForIdle();
}
