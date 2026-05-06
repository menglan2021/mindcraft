package com.mindcraft.voicebridge.voiceinput;

import com.mindcraft.voicebridge.config.PluginConfig;
import com.mindcraft.voicebridge.voice.BotEntityLocator;
import com.mindcraft.voicebridge.websocket.BridgeWebSocketServer;
import com.mindcraft.voicebridge.websocket.RegisteredBotSession;
import de.maxhenkel.voicechat.api.VoicechatConnection;
import de.maxhenkel.voicechat.api.VoicechatServerApi;
import de.maxhenkel.voicechat.api.events.MicrophonePacketEvent;
import de.maxhenkel.voicechat.api.opus.OpusDecoder;
import org.bukkit.entity.Player;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.logging.Logger;

public class VoiceInputManager {

    private static final double WHISPER_DISTANCE_MULTIPLIER = 0.45D;

    private final Logger logger;
    private final BotEntityLocator entityLocator;
    private final ScheduledExecutorService scheduler;
    private final Map<UUID, PlayerSpeechSession> activeSessions = new ConcurrentHashMap<>();
    private final Map<UUID, Long> lastTriggeredAt = new ConcurrentHashMap<>();

    private volatile PluginConfig pluginConfig;
    private volatile VoicechatServerApi voicechatServerApi;
    private volatile BridgeWebSocketServer bridgeWebSocketServer;

    public VoiceInputManager(Logger logger, PluginConfig pluginConfig) {
        this.logger = logger;
        this.pluginConfig = pluginConfig;
        this.entityLocator = new BotEntityLocator();
        this.scheduler = Executors.newSingleThreadScheduledExecutor(new ThreadFactory() {
            @Override
            public Thread newThread(Runnable runnable) {
                Thread thread = new Thread(runnable, "mindcraft-voice-input");
                thread.setDaemon(true);
                return thread;
            }
        });
        this.scheduler.scheduleAtFixedRate(this::flushReadySessions, 200L, 100L, TimeUnit.MILLISECONDS);
    }

    public void updatePluginConfig(PluginConfig pluginConfig) {
        this.pluginConfig = pluginConfig;
    }

    public void setVoicechatServerApi(VoicechatServerApi voicechatServerApi) {
        this.voicechatServerApi = voicechatServerApi;
        if (voicechatServerApi == null) {
            clearSessions();
        }
    }

    public void setBridgeWebSocketServer(BridgeWebSocketServer bridgeWebSocketServer) {
        this.bridgeWebSocketServer = bridgeWebSocketServer;
    }

    public void handleMicrophonePacket(MicrophonePacketEvent event) {
        VoicechatServerApi serverApi = voicechatServerApi;
        BridgeWebSocketServer bridgeServer = bridgeWebSocketServer;
        if (serverApi == null || bridgeServer == null) {
            return;
        }

        VoicechatConnection senderConnection = event.getSenderConnection();
        if (senderConnection == null || senderConnection.getPlayer() == null) {
            return;
        }

        Object rawPlayer = senderConnection.getPlayer().getPlayer();
        if (!(rawPlayer instanceof Player player) || !player.isOnline()) {
            return;
        }

        byte[] opusPacket = event.getPacket() == null ? null : event.getPacket().getOpusEncodedData();
        if (opusPacket == null || opusPacket.length == 0) {
            return;
        }

        boolean whispering = event.getPacket().isWhispering();
        long now = System.currentTimeMillis();

        PlayerSpeechSession session = activeSessions.get(player.getUniqueId());
        if (session == null) {
            RegisteredBotSession target = selectTargetBot(player, whispering);
            if (target == null) {
                return;
            }

            long cooldownStart = lastTriggeredAt.getOrDefault(player.getUniqueId(), 0L);
            if ((now - cooldownStart) < target.triggerCooldownMs()) {
                return;
            }

            OpusDecoder decoder = serverApi.createDecoder();
            if (decoder == null) {
                logger.warning("[MindcraftVoiceBridge] failed to create Opus decoder for voice input");
                return;
            }

            session = new PlayerSpeechSession(
                    player.getName(),
                    target.botName(),
                    target.connection(),
                    whispering,
                    pluginConfig.sampleRate(),
                    1,
                    target.endSilenceMs(),
                    target.minDurationMs(),
                    target.maxDurationMs(),
                    target.triggerCooldownMs(),
                    decoder,
                    serverApi.getAudioConverter()
            );
            activeSessions.put(player.getUniqueId(), session);
            bridgeServer.sendInputAudioStart(
                    session.getTargetConnection(),
                    session.getUtteranceId(),
                    session.getPlayerName(),
                    session.getTargetBot(),
                    session.getSampleRate(),
                    session.getChannels(),
                    session.isWhispering()
            );
        }

        try {
            byte[] pcmChunk = session.appendPacket(opusPacket, now);
            if (pcmChunk.length > 0) {
                bridgeServer.sendInputAudioChunk(
                        session.getTargetConnection(),
                        session.getUtteranceId(),
                        session.nextChunkSeq(),
                        session.getDurationMs(),
                        pcmChunk
                );
            }
            if (session.shouldFinalizeForMaxDuration()) {
                flushSession(player.getUniqueId(), session, false);
            }
        } catch (Exception exception) {
            logger.warning("[MindcraftVoiceBridge] voice input decode failed for " + player.getName() + ": " + exception.getMessage());
            flushSession(player.getUniqueId(), session, true);
        }
    }

    public void shutdown() {
        clearSessions();
        scheduler.shutdownNow();
    }

    public int getActiveInputSessions() {
        return activeSessions.size();
    }

    private RegisteredBotSession selectTargetBot(Player speaker, boolean whispering) {
        BridgeWebSocketServer bridgeServer = bridgeWebSocketServer;
        if (bridgeServer == null) {
            return null;
        }

        double maxDistance = pluginConfig.voiceDistance();
        if (whispering) {
            maxDistance *= WHISPER_DISTANCE_MULTIPLIER;
        }
        double maxDistanceSquared = maxDistance * maxDistance;

        RegisteredBotSession nearest = null;
        double nearestDistanceSquared = Double.MAX_VALUE;

        for (RegisteredBotSession registration : bridgeServer.getRegisteredBotSessions()) {
            if (registration.connection() == null || !registration.connection().isOpen()) {
                continue;
            }
            Player botPlayer = entityLocator.findOnlinePlayer(registration.botName());
            if (botPlayer == null || !botPlayer.isOnline()) {
                continue;
            }
            if (!botPlayer.getWorld().equals(speaker.getWorld())) {
                continue;
            }

            double distanceSquared = botPlayer.getLocation().distanceSquared(speaker.getLocation());
            if (distanceSquared > maxDistanceSquared) {
                continue;
            }
            if (distanceSquared < nearestDistanceSquared) {
                nearest = registration;
                nearestDistanceSquared = distanceSquared;
            }
        }

        return nearest;
    }

    private void flushReadySessions() {
        long now = System.currentTimeMillis();
        for (Map.Entry<UUID, PlayerSpeechSession> entry : activeSessions.entrySet()) {
            PlayerSpeechSession session = entry.getValue();
            if (session.shouldFinalizeForSilence(now)) {
                flushSession(entry.getKey(), session, false);
            }
        }
    }

    private void flushSession(UUID speakerUuid, PlayerSpeechSession session, boolean dropOnly) {
        if (!activeSessions.remove(speakerUuid, session)) {
            return;
        }

        try {
            lastTriggeredAt.put(speakerUuid, System.currentTimeMillis());

            if (dropOnly) {
                BridgeWebSocketServer bridgeServer = bridgeWebSocketServer;
                if (bridgeServer != null) {
                    bridgeServer.sendInputAudioEnd(
                            session.getTargetConnection(),
                            session.getUtteranceId(),
                            session.getDurationMs(),
                            true
                    );
                }
                return;
            }

            byte[] pcmBytes = session.getPcm16leBytes();
            if (pcmBytes.length == 0) {
                BridgeWebSocketServer bridgeServer = bridgeWebSocketServer;
                if (bridgeServer != null) {
                    bridgeServer.sendInputAudioEnd(
                            session.getTargetConnection(),
                            session.getUtteranceId(),
                            session.getDurationMs(),
                            true
                    );
                }
                return;
            }

            if (!session.isLongEnough()) {
                logger.info("[MindcraftVoiceBridge] dropped short voice input from " + session.getPlayerName() + " duration=" + session.getDurationMs() + "ms");
                BridgeWebSocketServer bridgeServer = bridgeWebSocketServer;
                if (bridgeServer != null) {
                    bridgeServer.sendInputAudioEnd(
                            session.getTargetConnection(),
                            session.getUtteranceId(),
                            session.getDurationMs(),
                            true
                    );
                }
                return;
            }

            BridgeWebSocketServer bridgeServer = bridgeWebSocketServer;
            if (bridgeServer == null) {
                return;
            }
            if (session.getTargetConnection() == null || !session.getTargetConnection().isOpen()) {
                logger.info("[MindcraftVoiceBridge] dropped voice input because target bot websocket is offline: " + session.getTargetBot());
                return;
            }

            bridgeServer.sendInputAudio(
                    session.getTargetConnection(),
                    session.getUtteranceId(),
                    session.getPlayerName(),
                    session.getTargetBot(),
                    session.getSampleRate(),
                    session.getChannels(),
                    session.isWhispering(),
                    session.getDurationMs(),
                    pcmBytes
            );
            bridgeServer.sendInputAudioEnd(
                    session.getTargetConnection(),
                    session.getUtteranceId(),
                    session.getDurationMs(),
                    false
            );
            logger.info("[MindcraftVoiceBridge] forwarded voice input " + session.getUtteranceId() + " player=" + session.getPlayerName() + " -> bot=" + session.getTargetBot() + " duration=" + session.getDurationMs() + "ms");
        } catch (Exception exception) {
            logger.warning("[MindcraftVoiceBridge] failed to forward voice input: " + exception.getMessage());
        } finally {
            session.close();
        }
    }

    private void clearSessions() {
        for (Map.Entry<UUID, PlayerSpeechSession> entry : activeSessions.entrySet()) {
            flushSession(entry.getKey(), entry.getValue(), true);
        }
        activeSessions.clear();
    }
}
