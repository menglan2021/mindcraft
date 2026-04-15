package com.mindcraft.voicebridge.voiceinput;

import de.maxhenkel.voicechat.api.audio.AudioConverter;
import de.maxhenkel.voicechat.api.opus.OpusDecoder;
import org.java_websocket.WebSocket;

import java.io.ByteArrayOutputStream;
import java.util.concurrent.atomic.AtomicLong;

public class PlayerSpeechSession {

    private static final AtomicLong COUNTER = new AtomicLong();

    private final String utteranceId;
    private final String playerName;
    private final String targetBot;
    private final WebSocket targetConnection;
    private final boolean whispering;
    private final int sampleRate;
    private final int channels;
    private final int endSilenceMs;
    private final int minDurationMs;
    private final int maxDurationMs;
    private final int triggerCooldownMs;
    private final OpusDecoder decoder;
    private final AudioConverter audioConverter;
    private final ByteArrayOutputStream pcmBuffer;
    private final long createdAtMs;
    private volatile long lastPacketAtMs;

    public PlayerSpeechSession(
            String playerName,
            String targetBot,
            WebSocket targetConnection,
            boolean whispering,
            int sampleRate,
            int channels,
            int endSilenceMs,
            int minDurationMs,
            int maxDurationMs,
            int triggerCooldownMs,
            OpusDecoder decoder,
            AudioConverter audioConverter
    ) {
        this.utteranceId = createUtteranceId(playerName, targetBot);
        this.playerName = playerName;
        this.targetBot = targetBot;
        this.targetConnection = targetConnection;
        this.whispering = whispering;
        this.sampleRate = sampleRate;
        this.channels = channels;
        this.endSilenceMs = endSilenceMs;
        this.minDurationMs = minDurationMs;
        this.maxDurationMs = maxDurationMs;
        this.triggerCooldownMs = triggerCooldownMs;
        this.decoder = decoder;
        this.audioConverter = audioConverter;
        this.pcmBuffer = new ByteArrayOutputStream();
        this.createdAtMs = System.currentTimeMillis();
        this.lastPacketAtMs = createdAtMs;
    }

    public void appendPacket(byte[] opusPacket, long nowMs) {
        short[] pcmSamples = decoder.decode(opusPacket);
        if (pcmSamples == null || pcmSamples.length == 0) {
            return;
        }
        byte[] pcmBytes = audioConverter.shortsToBytes(pcmSamples);
        pcmBuffer.writeBytes(pcmBytes);
        lastPacketAtMs = nowMs;
    }

    public boolean shouldFinalizeForSilence(long nowMs) {
        return nowMs - lastPacketAtMs >= endSilenceMs;
    }

    public boolean shouldFinalizeForMaxDuration() {
        return getDurationMs() >= maxDurationMs;
    }

    public boolean isLongEnough() {
        return getDurationMs() >= minDurationMs;
    }

    public long getDurationMs() {
        if (sampleRate <= 0 || channels <= 0) {
            return 0L;
        }
        int bytesPerMillisecond = Math.max(1, sampleRate * channels * 2 / 1000);
        return pcmBuffer.size() / bytesPerMillisecond;
    }

    public byte[] getPcm16leBytes() {
        return pcmBuffer.toByteArray();
    }

    public void close() {
        try {
            decoder.close();
        } catch (Exception ignored) {
        }
    }

    public String getUtteranceId() {
        return utteranceId;
    }

    public String getPlayerName() {
        return playerName;
    }

    public String getTargetBot() {
        return targetBot;
    }

    public WebSocket getTargetConnection() {
        return targetConnection;
    }

    public boolean isWhispering() {
        return whispering;
    }

    public int getSampleRate() {
        return sampleRate;
    }

    public int getChannels() {
        return channels;
    }

    public int getTriggerCooldownMs() {
        return triggerCooldownMs;
    }

    public long getCreatedAtMs() {
        return createdAtMs;
    }

    private static String createUtteranceId(String playerName, String targetBot) {
        String speaker = sanitize(playerName);
        String bot = sanitize(targetBot);
        return "in_" + speaker + "_" + bot + "_" + System.currentTimeMillis() + "_" + COUNTER.incrementAndGet();
    }

    private static String sanitize(String value) {
        return String.valueOf(value).replaceAll("[^a-zA-Z0-9_-]", "_");
    }
}
