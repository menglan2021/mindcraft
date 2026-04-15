package com.mindcraft.voicebridge.voice;

import com.mindcraft.voicebridge.config.PluginConfig;
import com.mindcraft.voicebridge.model.CancelMessage;
import com.mindcraft.voicebridge.model.ChunkMessage;
import com.mindcraft.voicebridge.model.EndMessage;
import com.mindcraft.voicebridge.model.StartMessage;
import com.mindcraft.voicebridge.util.Base64Audio;
import de.maxhenkel.voicechat.api.VoicechatServerApi;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Logger;

public class VoiceChannelManager {

    private final Logger logger;
    private final BotEntityLocator entityLocator;
    private final Map<String, BotAudioSession> sessionsByUtterance = new ConcurrentHashMap<>();
    private final Map<String, String> activeUtteranceByBot = new ConcurrentHashMap<>();

    private volatile PluginConfig pluginConfig;
    private volatile VoicechatServerApi voicechatServerApi;

    public VoiceChannelManager(Logger logger, PluginConfig pluginConfig) {
        this.logger = logger;
        this.pluginConfig = pluginConfig;
        this.entityLocator = new BotEntityLocator();
    }

    public void updatePluginConfig(PluginConfig pluginConfig) {
        this.pluginConfig = pluginConfig;
    }

    public void setVoicechatServerApi(VoicechatServerApi voicechatServerApi) {
        this.voicechatServerApi = voicechatServerApi;
    }

    public void handleStart(StartMessage message) {
        requireVoicechat(message.getUtteranceId());
        requireBotOnline(message.getBot(), message.getUtteranceId());

        if (message.getSampleRate() != pluginConfig.sampleRate()) {
            throw new VoiceBridgeException(
                    "UNSUPPORTED_SAMPLE_RATE",
                    "仅支持采样率 " + pluginConfig.sampleRate() + "，收到 " + message.getSampleRate(),
                    message.getUtteranceId()
            );
        }
        if (message.getChannels() != 1) {
            throw new VoiceBridgeException("INVALID_AUDIO_FORMAT", "当前仅支持单声道音频。", message.getUtteranceId());
        }
        if (sessionsByUtterance.containsKey(message.getUtteranceId())) {
            throw new VoiceBridgeException("SESSION_ALREADY_EXISTS", "重复的 utteranceId：" + message.getUtteranceId(), message.getUtteranceId());
        }

        String previousUtterance = activeUtteranceByBot.put(message.getBot(), message.getUtteranceId());
        if (previousUtterance != null && !previousUtterance.equals(message.getUtteranceId())) {
            BotAudioSession previousSession = sessionsByUtterance.remove(previousUtterance);
            if (previousSession != null) {
                previousSession.cancel();
                logger.info("[MindcraftVoiceBridge] replaced previous session " + previousUtterance + " for bot=" + message.getBot());
            }
        }

        BotAudioSession session = new BotAudioSession(
                logger,
                voicechatServerApi,
                pluginConfig,
                entityLocator,
                message.getUtteranceId(),
                message.getBot(),
                () -> removeSession(message.getUtteranceId(), message.getBot())
        );
        sessionsByUtterance.put(message.getUtteranceId(), session);
        logger.info("[MindcraftVoiceBridge] session started: " + message.getUtteranceId() + " bot=" + message.getBot());
    }

    public void handleChunk(ChunkMessage message) {
        BotAudioSession session = getRequiredSession(message.getUtteranceId());
        session.appendChunk(message.getSeq(), Base64Audio.decode(message.getPcm16leBase64()));
    }

    public void handleEnd(EndMessage message) {
        BotAudioSession session = getRequiredSession(message.getUtteranceId());
        session.markEnded();
        logger.info("[MindcraftVoiceBridge] session ending: " + message.getUtteranceId());
    }

    public void handleCancel(CancelMessage message) {
        BotAudioSession session = getRequiredSession(message.getUtteranceId());
        session.cancel();
        logger.info("[MindcraftVoiceBridge] session cancelled: " + message.getUtteranceId());
    }

    public void shutdown() {
        for (BotAudioSession session : sessionsByUtterance.values()) {
            session.cancel();
        }
        sessionsByUtterance.clear();
        activeUtteranceByBot.clear();
    }

    public String getStatusSummary() {
        return "voicechatReady=" + (voicechatServerApi != null)
                + ", activeSessions=" + sessionsByUtterance.size()
                + ", bridge=" + pluginConfig.bridgeHost() + ":" + pluginConfig.bridgePort();
    }

    private BotAudioSession getRequiredSession(String utteranceId) {
        BotAudioSession session = sessionsByUtterance.get(utteranceId);
        if (session == null) {
            throw new VoiceBridgeException("SESSION_NOT_FOUND", "找不到语音会话：" + utteranceId, utteranceId);
        }
        return session;
    }

    private void removeSession(String utteranceId, String botName) {
        sessionsByUtterance.remove(utteranceId);
        activeUtteranceByBot.remove(botName, utteranceId);
    }

    private void requireVoicechat(String utteranceId) {
        if (voicechatServerApi == null) {
            throw new VoiceBridgeException("VOICECHAT_NOT_AVAILABLE", "Simple Voice Chat API 尚未就绪。", utteranceId);
        }
    }

    private void requireBotOnline(String botName, String utteranceId) {
        if (entityLocator.findOnlinePlayer(botName) == null) {
            throw new VoiceBridgeException("BOT_NOT_FOUND", "找不到在线 bot 玩家：" + botName, utteranceId);
        }
    }
}
