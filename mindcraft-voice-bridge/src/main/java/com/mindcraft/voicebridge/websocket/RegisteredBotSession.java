package com.mindcraft.voicebridge.websocket;

import com.mindcraft.voicebridge.model.RegisterBotMessage;
import org.java_websocket.WebSocket;

public record RegisteredBotSession(
        WebSocket connection,
        String botName,
        boolean echoToChat,
        int endSilenceMs,
        int minDurationMs,
        int maxDurationMs,
        int triggerCooldownMs
) {

    private static final int DEFAULT_END_SILENCE_MS = 900;
    private static final int DEFAULT_MIN_DURATION_MS = 700;
    private static final int DEFAULT_MAX_DURATION_MS = 15000;
    private static final int DEFAULT_TRIGGER_COOLDOWN_MS = 500;

    public static RegisteredBotSession from(WebSocket connection, RegisterBotMessage message) {
        return new RegisteredBotSession(
                connection,
                message.getBot(),
                message.isEchoToChat(),
                sanitize(message.getEndSilenceMs(), DEFAULT_END_SILENCE_MS),
                sanitize(message.getMinDurationMs(), DEFAULT_MIN_DURATION_MS),
                sanitize(message.getMaxDurationMs(), DEFAULT_MAX_DURATION_MS),
                sanitize(message.getTriggerCooldownMs(), DEFAULT_TRIGGER_COOLDOWN_MS)
        );
    }

    public boolean matchesBot(String botName) {
        return botName != null && botName.equalsIgnoreCase(this.botName);
    }

    private static int sanitize(int value, int fallback) {
        return value > 0 ? value : fallback;
    }
}
