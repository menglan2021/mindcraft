let utteranceCounter = 0;

export const DEFAULT_VOICE_OUTPUT_MODE = 'local_player';
export const DEFAULT_BRIDGE_HOST = '127.0.0.1';
export const DEFAULT_BRIDGE_PORT = 8787;
export const DEFAULT_BRIDGE_SAMPLE_RATE = 48000;
export const DEFAULT_BRIDGE_CHANNELS = 1;
export const DEFAULT_FRAME_DURATION_MS = 20;
export const DEFAULT_VOICE_INPUT_STT_MODEL = 'qwen/qwen3-asr-flash';
export const DEFAULT_VOICE_INPUT_LANGUAGE = 'zh';
export const DEFAULT_VOICE_INPUT_END_SILENCE_MS = 900;
export const DEFAULT_VOICE_INPUT_MIN_DURATION_MS = 700;
export const DEFAULT_VOICE_INPUT_MAX_DURATION_MS = 15000;
export const DEFAULT_VOICE_INPUT_TRIGGER_COOLDOWN_MS = 500;

function toPositiveInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getVoiceOutputMode(globalSettings = {}, profile = {}) {
    const mode = profile.voice_output_mode || globalSettings.voice_output_mode || DEFAULT_VOICE_OUTPUT_MODE;
    if (['system', 'local_player', 'minecraft_voicechat'].includes(mode)) {
        return mode;
    }
    return DEFAULT_VOICE_OUTPUT_MODE;
}

export function normalizeVoiceBridgeConfig(globalSettings = {}, profile = {}) {
    const bridge = profile.voice_bridge || {};

    return {
        enabled: bridge.enabled ?? (getVoiceOutputMode(globalSettings, profile) === 'minecraft_voicechat'),
        host: bridge.host || globalSettings.voice_bridge_host || DEFAULT_BRIDGE_HOST,
        port: toPositiveInteger(bridge.port ?? globalSettings.voice_bridge_port, DEFAULT_BRIDGE_PORT),
        botEntityName: bridge.bot_entity_name || profile.name || 'mindcraft_bot',
        sampleRate: toPositiveInteger(bridge.sample_rate ?? globalSettings.voice_target_sample_rate, DEFAULT_BRIDGE_SAMPLE_RATE),
        channels: toPositiveInteger(bridge.channels, DEFAULT_BRIDGE_CHANNELS),
        frameDurationMs: toPositiveInteger(bridge.frame_duration_ms, DEFAULT_FRAME_DURATION_MS),
        streaming: bridge.streaming ?? globalSettings.voice_streaming ?? true,
    };
}

export function buildBridgeUrl(config) {
    return `ws://${config.host}:${config.port}`;
}

export function normalizeVoiceInputConfig(globalSettings = {}, profile = {}) {
    const voiceInput = profile.voice_input || {};
    const bridge = normalizeVoiceBridgeConfig(globalSettings, profile);

    return {
        enabled: voiceInput.enabled ?? globalSettings.voice_input_enabled ?? false,
        echoToChat: voiceInput.echo_to_chat ?? globalSettings.voice_input_echo_to_chat ?? false,
        sttModel: voiceInput.stt_model || globalSettings.voice_input_stt_model || DEFAULT_VOICE_INPUT_STT_MODEL,
        sttUrl: voiceInput.stt_url || globalSettings.voice_input_stt_url || '',
        language: voiceInput.language || globalSettings.voice_input_language || DEFAULT_VOICE_INPUT_LANGUAGE,
        prompt: voiceInput.prompt || globalSettings.voice_input_prompt || '',
        endSilenceMs: toPositiveInteger(voiceInput.end_silence_ms ?? globalSettings.voice_input_end_silence_ms, DEFAULT_VOICE_INPUT_END_SILENCE_MS),
        minDurationMs: toPositiveInteger(voiceInput.min_duration_ms ?? globalSettings.voice_input_min_duration_ms, DEFAULT_VOICE_INPUT_MIN_DURATION_MS),
        maxDurationMs: toPositiveInteger(voiceInput.max_duration_ms ?? globalSettings.voice_input_max_duration_ms, DEFAULT_VOICE_INPUT_MAX_DURATION_MS),
        triggerCooldownMs: toPositiveInteger(voiceInput.trigger_cooldown_ms ?? globalSettings.voice_input_trigger_cooldown_ms, DEFAULT_VOICE_INPUT_TRIGGER_COOLDOWN_MS),
        host: bridge.host,
        port: bridge.port,
        botEntityName: bridge.botEntityName,
    };
}

export function createUtteranceId(botName = 'bot') {
    utteranceCounter += 1;
    const normalized = String(botName).replace(/[^a-zA-Z0-9_-]/g, '_');
    return `u_${normalized}_${Date.now()}_${utteranceCounter}`;
}

export function createStartMessage({ utteranceId, bot, sampleRate, channels }) {
    return {
        type: 'start',
        utteranceId,
        bot,
        sampleRate,
        channels,
    };
}

export function createChunkMessage({ utteranceId, seq, pcm16le }) {
    return {
        type: 'chunk',
        utteranceId,
        seq,
        pcm16le_base64: Buffer.from(pcm16le).toString('base64'),
    };
}

export function createEndMessage({ utteranceId }) {
    return {
        type: 'end',
        utteranceId,
    };
}

export function createCancelMessage({ utteranceId }) {
    return {
        type: 'cancel',
        utteranceId,
    };
}

export function createPingMessage() {
    return {
        type: 'ping',
        ts: Date.now(),
    };
}

export function createRegisterBotMessage({
    bot,
    echoToChat = false,
    endSilenceMs = DEFAULT_VOICE_INPUT_END_SILENCE_MS,
    minDurationMs = DEFAULT_VOICE_INPUT_MIN_DURATION_MS,
    maxDurationMs = DEFAULT_VOICE_INPUT_MAX_DURATION_MS,
    triggerCooldownMs = DEFAULT_VOICE_INPUT_TRIGGER_COOLDOWN_MS,
}) {
    return {
        type: 'register_bot',
        bot,
        echoToChat,
        endSilenceMs,
        minDurationMs,
        maxDurationMs,
        triggerCooldownMs,
    };
}

export function createEchoChatMessage({ utteranceId, speaker, targetBot, text }) {
    return {
        type: 'echo_chat',
        utteranceId,
        speaker,
        targetBot,
        text,
    };
}
