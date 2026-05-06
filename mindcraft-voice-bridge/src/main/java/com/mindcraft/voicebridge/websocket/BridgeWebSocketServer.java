package com.mindcraft.voicebridge.websocket;

import com.google.gson.JsonParseException;
import com.mindcraft.voicebridge.model.BridgeMessage;
import com.mindcraft.voicebridge.model.CancelMessage;
import com.mindcraft.voicebridge.model.ChunkMessage;
import com.mindcraft.voicebridge.model.EchoChatMessage;
import com.mindcraft.voicebridge.model.EndMessage;
import com.mindcraft.voicebridge.model.PingMessage;
import com.mindcraft.voicebridge.model.RegisterBotMessage;
import com.mindcraft.voicebridge.model.StartMessage;
import com.mindcraft.voicebridge.voice.VoiceBridgeException;
import com.mindcraft.voicebridge.voice.VoiceChannelManager;
import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;

import java.net.InetSocketAddress;
import java.util.Collection;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;
import java.util.logging.Logger;

public class BridgeWebSocketServer extends WebSocketServer {

    private final Logger logger;
    private final VoiceChannelManager voiceChannelManager;
    private final MessageCodec messageCodec;
    private final Consumer<EchoChatMessage> echoChatHandler;
    private final Map<WebSocket, RegisteredBotSession> registeredBotSessions = new ConcurrentHashMap<>();

    public BridgeWebSocketServer(Logger logger, InetSocketAddress address, VoiceChannelManager voiceChannelManager, Consumer<EchoChatMessage> echoChatHandler) {
        super(address);
        this.logger = logger;
        this.voiceChannelManager = voiceChannelManager;
        this.messageCodec = new MessageCodec();
        this.echoChatHandler = echoChatHandler;
    }

    @Override
    public void onOpen(WebSocket connection, ClientHandshake handshake) {
        logger.info("[MindcraftVoiceBridge] websocket connected: " + connection.getRemoteSocketAddress());
    }

    @Override
    public void onClose(WebSocket connection, int code, String reason, boolean remote) {
        registeredBotSessions.remove(connection);
        logger.info("[MindcraftVoiceBridge] websocket closed: " + connection.getRemoteSocketAddress() + " code=" + code + " reason=" + reason);
    }

    @Override
    public void onMessage(WebSocket connection, String message) {
        try {
            BridgeMessage decoded = messageCodec.decode(message);
            switch (decoded) {
                case StartMessage startMessage -> {
                    voiceChannelManager.handleStart(startMessage);
                    connection.send(messageCodec.encodeAck("start", startMessage.getUtteranceId()));
                }
                case ChunkMessage chunkMessage -> {
                    voiceChannelManager.handleChunk(chunkMessage);
                    connection.send(messageCodec.encodeAck("chunk", chunkMessage.getUtteranceId()));
                }
                case EndMessage endMessage -> {
                    voiceChannelManager.handleEnd(endMessage);
                    connection.send(messageCodec.encodeAck("end", endMessage.getUtteranceId()));
                }
                case CancelMessage cancelMessage -> {
                    voiceChannelManager.handleCancel(cancelMessage);
                    connection.send(messageCodec.encodeAck("cancel", cancelMessage.getUtteranceId()));
                }
                case PingMessage ignored -> connection.send(messageCodec.encodeAck("ping", null));
                case RegisterBotMessage registerBotMessage -> {
                    registeredBotSessions.entrySet().removeIf(entry -> entry.getKey() != connection && entry.getValue().matchesBot(registerBotMessage.getBot()));
                    registeredBotSessions.put(connection, RegisteredBotSession.from(connection, registerBotMessage));
                    connection.send(messageCodec.encodeAck("register_bot", registerBotMessage.getBot()));
                }
                case EchoChatMessage echoChatMessage -> {
                    RegisteredBotSession registration = registeredBotSessions.get(connection);
                    if (registration == null) {
                        throw new JsonParseException("unregistered connection cannot echo chat");
                    }
                    if (!registration.matchesBot(echoChatMessage.getTargetBot())) {
                        throw new JsonParseException("echo_chat targetBot mismatch");
                    }
                    echoChatHandler.accept(echoChatMessage);
                    connection.send(messageCodec.encodeAck("echo_chat", echoChatMessage.getUtteranceId()));
                }
                default -> throw new JsonParseException("unsupported message");
            }
        } catch (VoiceBridgeException exception) {
            logger.warning("[MindcraftVoiceBridge] protocol error " + exception.getCode() + ": " + exception.getMessage());
            connection.send(messageCodec.encodeError(exception.getCode(), exception.getMessage(), exception.getUtteranceId()));
        } catch (JsonParseException exception) {
            logger.warning("[MindcraftVoiceBridge] invalid payload: " + exception.getMessage());
            connection.send(messageCodec.encodeError("INVALID_MESSAGE", exception.getMessage(), null));
        } catch (Exception exception) {
            logger.warning("[MindcraftVoiceBridge] unexpected websocket error: " + exception.getMessage());
            connection.send(messageCodec.encodeError("INTERNAL_ERROR", exception.getMessage(), null));
        }
    }

    @Override
    public void onError(WebSocket connection, Exception exception) {
        logger.warning("[MindcraftVoiceBridge] websocket server error: " + exception.getMessage());
    }

    @Override
    public void onStart() {
        logger.info("[MindcraftVoiceBridge] websocket server started on " + getAddress());
    }

    public Collection<RegisteredBotSession> getRegisteredBotSessions() {
        return registeredBotSessions.values();
    }

    public void sendInputAudio(
            WebSocket connection,
            String utteranceId,
            String player,
            String targetBot,
            int sampleRate,
            int channels,
            boolean whispering,
            long durationMs,
            byte[] pcm16le
    ) {
        if (connection == null || !connection.isOpen()) {
            return;
        }
        connection.send(messageCodec.encodeInputAudio(
                utteranceId,
                player,
                targetBot,
                sampleRate,
                channels,
                whispering,
                durationMs,
                pcm16le
        ));
    }

    public void sendInputAudioStart(
            WebSocket connection,
            String utteranceId,
            String player,
            String targetBot,
            int sampleRate,
            int channels,
            boolean whispering
    ) {
        if (connection == null || !connection.isOpen()) {
            return;
        }
        connection.send(messageCodec.encodeInputAudioStart(
                utteranceId,
                player,
                targetBot,
                sampleRate,
                channels,
                whispering
        ));
    }

    public void sendInputAudioChunk(
            WebSocket connection,
            String utteranceId,
            int seq,
            long durationMs,
            byte[] pcm16le
    ) {
        if (connection == null || !connection.isOpen()) {
            return;
        }
        connection.send(messageCodec.encodeInputAudioChunk(
                utteranceId,
                seq,
                durationMs,
                pcm16le
        ));
    }

    public void sendInputAudioEnd(
            WebSocket connection,
            String utteranceId,
            long durationMs,
            boolean dropOnly
    ) {
        if (connection == null || !connection.isOpen()) {
            return;
        }
        connection.send(messageCodec.encodeInputAudioEnd(
                utteranceId,
                durationMs,
                dropOnly
        ));
    }
}
