package com.mindcraft.voicebridge.model;

public class StartMessage implements BridgeMessage {

    private String type;
    private String utteranceId;
    private String bot;
    private int sampleRate;
    private int channels;

    @Override
    public String getType() {
        return type;
    }

    public String getUtteranceId() {
        return utteranceId;
    }

    public String getBot() {
        return bot;
    }

    public int getSampleRate() {
        return sampleRate;
    }

    public int getChannels() {
        return channels;
    }
}
