package com.mindcraft.voicebridge.config;

import org.bukkit.configuration.file.FileConfiguration;

public record PluginConfig(
        String bridgeHost,
        int bridgePort,
        int sampleRate,
        float voiceDistance,
        boolean whispering,
        int bufferPollTimeoutMs
) {

    public static PluginConfig from(FileConfiguration config) {
        return new PluginConfig(
                config.getString("bridge.host", "127.0.0.1"),
                config.getInt("bridge.port", 8787),
                config.getInt("voice.sample_rate", 48000),
                (float) config.getDouble("voice.distance", 48.0D),
                config.getBoolean("voice.whispering", false),
                config.getInt("voice.buffer_poll_timeout_ms", 40)
        );
    }
}
