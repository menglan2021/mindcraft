package com.mindcraft.voicebridge.voice;

import com.mindcraft.voicebridge.config.PluginConfig;
import de.maxhenkel.voicechat.api.VoicechatServerApi;
import de.maxhenkel.voicechat.api.audiochannel.AudioPlayer;
import de.maxhenkel.voicechat.api.audiochannel.EntityAudioChannel;
import de.maxhenkel.voicechat.api.opus.OpusEncoder;
import org.bukkit.entity.Player;

import java.util.UUID;
import java.util.logging.Logger;

public class BotAudioSession {

    private static final int FRAME_SAMPLES = 960;
    private static final int FRAME_BYTES = FRAME_SAMPLES * 2;

    private final Logger logger;
    private final VoicechatServerApi voicechatServerApi;
    private final PluginConfig pluginConfig;
    private final BotEntityLocator entityLocator;
    private final String utteranceId;
    private final String botName;
    private final AudioFrameBuffer buffer;
    private final Runnable onClosed;

    private boolean closed;
    private UUID boundPlayerUuid;
    private EntityAudioChannel audioChannel;
    private AudioPlayer audioPlayer;
    private OpusEncoder opusEncoder;

    public BotAudioSession(
            Logger logger,
            VoicechatServerApi voicechatServerApi,
            PluginConfig pluginConfig,
            BotEntityLocator entityLocator,
            String utteranceId,
            String botName,
            Runnable onClosed
    ) {
        this.logger = logger;
        this.voicechatServerApi = voicechatServerApi;
        this.pluginConfig = pluginConfig;
        this.entityLocator = entityLocator;
        this.utteranceId = utteranceId;
        this.botName = botName;
        this.buffer = new AudioFrameBuffer();
        this.onClosed = onClosed;
    }

    public synchronized void appendChunk(int seq, byte[] pcmBytes) {
        ensureOpen();
        ensureStarted();
        refreshBoundEntity();

        if (pcmBytes.length != FRAME_BYTES) {
            throw new VoiceBridgeException(
                    "INVALID_AUDIO_FORMAT",
                    "utteranceId=" + utteranceId + " 期望 1920 字节 PCM 帧，实际收到 " + pcmBytes.length,
                    utteranceId
            );
        }

        buffer.offer(decodeFrame(pcmBytes));
        if (seq == 1) {
            logger.info("[MindcraftVoiceBridge] first frame received for " + utteranceId);
        }
    }

    public synchronized void markEnded() {
        if (closed) {
            return;
        }
        buffer.markEnded();
        if (audioPlayer == null) {
            close();
        }
    }

    public synchronized void cancel() {
        if (closed) {
            return;
        }
        buffer.cancel();
        if (audioPlayer != null) {
            audioPlayer.stopPlaying();
        }
        close();
    }

    private void ensureStarted() {
        if (audioPlayer != null) {
            return;
        }

        Player player = entityLocator.findOnlinePlayer(botName);
        if (player == null) {
            throw new VoiceBridgeException("BOT_NOT_FOUND", "找不到在线 bot 玩家：" + botName, utteranceId);
        }

        boundPlayerUuid = player.getUniqueId();
        audioChannel = voicechatServerApi.createEntityAudioChannel(UUID.randomUUID(), voicechatServerApi.fromEntity(player));
        if (audioChannel == null) {
            throw new VoiceBridgeException("VOICECHAT_NOT_AVAILABLE", "无法创建实体语音通道。", utteranceId);
        }
        audioChannel.setDistance(pluginConfig.voiceDistance());
        audioChannel.setWhispering(pluginConfig.whispering());

        opusEncoder = voicechatServerApi.createEncoder();
        audioPlayer = voicechatServerApi.createAudioPlayer(
                audioChannel,
                opusEncoder,
                () -> buffer.nextFrame(pluginConfig.bufferPollTimeoutMs(), FRAME_SAMPLES)
        );
        audioPlayer.setOnStopped(this::close);
        audioPlayer.startPlaying();

        logger.info("[MindcraftVoiceBridge] audio player started for " + utteranceId + " bot=" + botName);
    }

    private void refreshBoundEntity() {
        if (audioChannel == null) {
            return;
        }

        Player currentPlayer = entityLocator.findOnlinePlayer(botName);
        if (currentPlayer == null) {
            return;
        }
        if (currentPlayer.getUniqueId().equals(boundPlayerUuid)) {
            return;
        }

        boundPlayerUuid = currentPlayer.getUniqueId();
        audioChannel.updateEntity(voicechatServerApi.fromEntity(currentPlayer));
        logger.info("[MindcraftVoiceBridge] entity rebound for " + utteranceId + " -> " + currentPlayer.getName());
    }

    private short[] decodeFrame(byte[] pcmBytes) {
        short[] frame = new short[FRAME_SAMPLES];
        for (int i = 0; i < FRAME_SAMPLES; i++) {
            int low = pcmBytes[i * 2] & 0xFF;
            int high = pcmBytes[i * 2 + 1] & 0xFF;
            frame[i] = (short) ((high << 8) | low);
        }
        return frame;
    }

    private void ensureOpen() {
        if (closed) {
            throw new VoiceBridgeException("SESSION_NOT_FOUND", "语音会话已关闭：" + utteranceId, utteranceId);
        }
    }

    private synchronized void close() {
        if (closed) {
            return;
        }
        closed = true;

        if (audioChannel != null && !audioChannel.isClosed()) {
            audioChannel.flush();
        }
        if (opusEncoder != null) {
            opusEncoder.close();
            opusEncoder = null;
        }

        logger.info("[MindcraftVoiceBridge] session closed: " + utteranceId);
        onClosed.run();
    }
}
