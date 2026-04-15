package com.mindcraft.voicebridge.websocket;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.mindcraft.voicebridge.model.BridgeMessage;
import com.mindcraft.voicebridge.model.CancelMessage;
import com.mindcraft.voicebridge.model.ChunkMessage;
import com.mindcraft.voicebridge.model.EchoChatMessage;
import com.mindcraft.voicebridge.model.EndMessage;
import com.mindcraft.voicebridge.model.PingMessage;
import com.mindcraft.voicebridge.model.RegisterBotMessage;
import com.mindcraft.voicebridge.model.StartMessage;

import java.util.Base64;

public class MessageCodec {

    private final Gson gson = new Gson();

    public BridgeMessage decode(String raw) {
        JsonObject json = gson.fromJson(raw, JsonObject.class);
        if (json == null || !json.has("type")) {
            throw new JsonParseException("message.type is required");
        }

        String type = json.get("type").getAsString();
        return switch (type) {
            case "start" -> gson.fromJson(raw, StartMessage.class);
            case "chunk" -> gson.fromJson(raw, ChunkMessage.class);
            case "end" -> gson.fromJson(raw, EndMessage.class);
            case "cancel" -> gson.fromJson(raw, CancelMessage.class);
            case "ping" -> gson.fromJson(raw, PingMessage.class);
            case "register_bot" -> gson.fromJson(raw, RegisterBotMessage.class);
            case "echo_chat" -> gson.fromJson(raw, EchoChatMessage.class);
            default -> throw new JsonParseException("unsupported message type: " + type);
        };
    }

    public String encodeAck(String event, String utteranceId) {
        JsonObject payload = new JsonObject();
        payload.addProperty("type", "ack");
        payload.addProperty("event", event);
        if (utteranceId != null && !utteranceId.isBlank()) {
            payload.addProperty("utteranceId", utteranceId);
        }
        return gson.toJson(payload);
    }

    public String encodeError(String code, String message, String utteranceId) {
        JsonObject payload = new JsonObject();
        payload.addProperty("type", "error");
        payload.addProperty("code", code);
        payload.addProperty("message", message);
        if (utteranceId != null && !utteranceId.isBlank()) {
            payload.addProperty("utteranceId", utteranceId);
        }
        return gson.toJson(payload);
    }

    public String encodeInputAudio(
            String utteranceId,
            String player,
            String targetBot,
            int sampleRate,
            int channels,
            boolean whispering,
            long durationMs,
            byte[] pcm16le
    ) {
        JsonObject payload = new JsonObject();
        payload.addProperty("type", "input_audio");
        payload.addProperty("utteranceId", utteranceId);
        payload.addProperty("player", player);
        payload.addProperty("targetBot", targetBot);
        payload.addProperty("sampleRate", sampleRate);
        payload.addProperty("channels", channels);
        payload.addProperty("whispering", whispering);
        payload.addProperty("durationMs", durationMs);
        payload.addProperty("pcm16le_base64", Base64.getEncoder().encodeToString(pcm16le));
        return gson.toJson(payload);
    }
}
