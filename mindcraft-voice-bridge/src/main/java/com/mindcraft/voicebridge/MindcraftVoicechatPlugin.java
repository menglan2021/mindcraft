package com.mindcraft.voicebridge;

import de.maxhenkel.voicechat.api.VoicechatApi;
import de.maxhenkel.voicechat.api.VoicechatPlugin;
import de.maxhenkel.voicechat.api.events.EventRegistration;
import de.maxhenkel.voicechat.api.events.MicrophonePacketEvent;
import de.maxhenkel.voicechat.api.events.VoicechatServerStartedEvent;
import de.maxhenkel.voicechat.api.events.VoicechatServerStoppedEvent;

public class MindcraftVoicechatPlugin implements VoicechatPlugin {

    private final MindcraftVoiceBridgePlugin plugin;

    public MindcraftVoicechatPlugin(MindcraftVoiceBridgePlugin plugin) {
        this.plugin = plugin;
    }

    @Override
    public String getPluginId() {
        return "mindcraft_voice_bridge";
    }

    @Override
    public void initialize(VoicechatApi api) {
        plugin.getLogger().info("[MindcraftVoiceBridge] voicechat plugin initialized");
    }

    @Override
    public void registerEvents(EventRegistration registration) {
        registration.registerEvent(VoicechatServerStartedEvent.class, event -> plugin.handleVoicechatReady(event.getVoicechat()));
        registration.registerEvent(VoicechatServerStoppedEvent.class, event -> plugin.handleVoicechatStopped());
        registration.registerEvent(MicrophonePacketEvent.class, plugin::handleMicrophonePacket);
    }
}
