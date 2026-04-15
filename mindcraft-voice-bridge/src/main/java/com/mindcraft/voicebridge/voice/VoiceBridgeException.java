package com.mindcraft.voicebridge.voice;

public class VoiceBridgeException extends RuntimeException {

    private final String code;
    private final String utteranceId;

    public VoiceBridgeException(String code, String message, String utteranceId) {
        super(message);
        this.code = code;
        this.utteranceId = utteranceId;
    }

    public String getCode() {
        return code;
    }

    public String getUtteranceId() {
        return utteranceId;
    }
}
