package com.mindcraft.voicebridge.model;

public class EchoChatMessage implements BridgeMessage {

    private String type;
    private String utteranceId;
    private String speaker;
    private String targetBot;
    private String text;

    @Override
    public String getType() {
        return type;
    }

    public String getUtteranceId() {
        return utteranceId;
    }

    public String getSpeaker() {
        return speaker;
    }

    public String getTargetBot() {
        return targetBot;
    }

    public String getText() {
        return text;
    }
}
