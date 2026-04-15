package com.mindcraft.voicebridge.model;

public class EndMessage implements BridgeMessage {

    private String type;
    private String utteranceId;

    @Override
    public String getType() {
        return type;
    }

    public String getUtteranceId() {
        return utteranceId;
    }
}
