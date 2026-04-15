package com.mindcraft.voicebridge.model;

public class ChunkMessage implements BridgeMessage {

    private String type;
    private String utteranceId;
    private int seq;
    private String pcm16le_base64;

    @Override
    public String getType() {
        return type;
    }

    public String getUtteranceId() {
        return utteranceId;
    }

    public int getSeq() {
        return seq;
    }

    public String getPcm16leBase64() {
        return pcm16le_base64;
    }
}
