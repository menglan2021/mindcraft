package com.mindcraft.voicebridge.model;

public class RegisterBotMessage implements BridgeMessage {

    private String type;
    private String bot;
    private boolean echoToChat;
    private int endSilenceMs;
    private int minDurationMs;
    private int maxDurationMs;
    private int triggerCooldownMs;

    @Override
    public String getType() {
        return type;
    }

    public String getBot() {
        return bot;
    }

    public boolean isEchoToChat() {
        return echoToChat;
    }

    public int getEndSilenceMs() {
        return endSilenceMs;
    }

    public int getMinDurationMs() {
        return minDurationMs;
    }

    public int getMaxDurationMs() {
        return maxDurationMs;
    }

    public int getTriggerCooldownMs() {
        return triggerCooldownMs;
    }
}
