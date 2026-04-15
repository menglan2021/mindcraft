package com.mindcraft.voicebridge.model;

public class PingMessage implements BridgeMessage {

    private String type;
    private long ts;

    @Override
    public String getType() {
        return type;
    }

    public long getTs() {
        return ts;
    }
}
