package com.mindcraft.voicebridge;

import com.mindcraft.voicebridge.command.VoiceBridgeDebugCommand;
import com.mindcraft.voicebridge.config.PluginConfig;
import com.mindcraft.voicebridge.model.EchoChatMessage;
import com.mindcraft.voicebridge.voice.VoiceChannelManager;
import com.mindcraft.voicebridge.voiceinput.VoiceInputManager;
import com.mindcraft.voicebridge.websocket.BridgeWebSocketServer;
import de.maxhenkel.voicechat.api.BukkitVoicechatService;
import de.maxhenkel.voicechat.api.events.MicrophonePacketEvent;
import de.maxhenkel.voicechat.api.VoicechatServerApi;
import net.kyori.adventure.text.Component;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

import java.net.InetSocketAddress;

public class MindcraftVoiceBridgePlugin extends JavaPlugin {

    private PluginConfig pluginConfig;
    private VoiceChannelManager voiceChannelManager;
    private VoiceInputManager voiceInputManager;
    private BridgeWebSocketServer bridgeWebSocketServer;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        this.pluginConfig = PluginConfig.from(getConfig());
        this.voiceChannelManager = new VoiceChannelManager(getLogger(), pluginConfig);
        this.voiceInputManager = new VoiceInputManager(getLogger(), pluginConfig);

        VoiceBridgeDebugCommand command = new VoiceBridgeDebugCommand(this);
        if (getCommand("voicebridge") != null) {
            getCommand("voicebridge").setExecutor(command);
        }

        registerVoicechatPlugin();
        startWebSocketServer();
    }

    @Override
    public void onDisable() {
        stopWebSocketServer();
        if (voiceChannelManager != null) {
            voiceChannelManager.shutdown();
        }
        if (voiceInputManager != null) {
            voiceInputManager.shutdown();
        }
    }

    public void reloadPluginConfiguration() {
        reloadConfig();
        this.pluginConfig = PluginConfig.from(getConfig());
        this.voiceChannelManager.updatePluginConfig(pluginConfig);
        this.voiceInputManager.updatePluginConfig(pluginConfig);
        stopWebSocketServer();
        startWebSocketServer();
    }

    public void handleVoicechatReady(VoicechatServerApi voicechatServerApi) {
        voiceChannelManager.setVoicechatServerApi(voicechatServerApi);
        voiceInputManager.setVoicechatServerApi(voicechatServerApi);
        getLogger().info("[MindcraftVoiceBridge] Simple Voice Chat server API ready");
    }

    public void handleVoicechatStopped() {
        voiceChannelManager.setVoicechatServerApi(null);
        voiceInputManager.setVoicechatServerApi(null);
        getLogger().warning("[MindcraftVoiceBridge] Simple Voice Chat server API stopped");
    }

    public VoiceChannelManager getVoiceChannelManager() {
        return voiceChannelManager;
    }

    public VoiceInputManager getVoiceInputManager() {
        return voiceInputManager;
    }

    public String getStatusSummary() {
        int registeredInputBots = bridgeWebSocketServer == null ? 0 : bridgeWebSocketServer.getRegisteredBotSessions().size();
        return voiceChannelManager.getStatusSummary()
                + ", registeredInputBots=" + registeredInputBots
                + ", activeInputSessions=" + (voiceInputManager == null ? 0 : voiceInputManager.getActiveInputSessions());
    }

    private void registerVoicechatPlugin() {
        BukkitVoicechatService service = getServer().getServicesManager().load(BukkitVoicechatService.class);
        if (service == null) {
            getLogger().warning("[MindcraftVoiceBridge] BukkitVoicechatService not found during enable");
            return;
        }
        service.registerPlugin(new MindcraftVoicechatPlugin(this));
        getLogger().info("[MindcraftVoiceBridge] registered voicechat addon");
    }

    private void startWebSocketServer() {
        try {
            bridgeWebSocketServer = new BridgeWebSocketServer(
                    getLogger(),
                    new InetSocketAddress(pluginConfig.bridgeHost(), pluginConfig.bridgePort()),
                    voiceChannelManager,
                    this::broadcastVoiceInputEcho
            );
            voiceInputManager.setBridgeWebSocketServer(bridgeWebSocketServer);
            bridgeWebSocketServer.start();
        } catch (Exception exception) {
            throw new IllegalStateException("无法启动 MindcraftVoiceBridge WebSocket 服务", exception);
        }
    }

    private void stopWebSocketServer() {
        if (bridgeWebSocketServer == null) {
            return;
        }
        try {
            bridgeWebSocketServer.stop(1000);
        } catch (Exception exception) {
            getLogger().warning("[MindcraftVoiceBridge] stop websocket server failed: " + exception.getMessage());
        } finally {
            voiceInputManager.setBridgeWebSocketServer(null);
            bridgeWebSocketServer = null;
        }
    }

    public void handleMicrophonePacket(MicrophonePacketEvent event) {
        if (voiceInputManager == null) {
            return;
        }
        voiceInputManager.handleMicrophonePacket(event);
    }

    private void broadcastVoiceInputEcho(EchoChatMessage message) {
        if (message == null || message.getText() == null || message.getText().isBlank()) {
            return;
        }
        String formatted = "【语音转写】来自 " + message.getSpeaker() + " 的语音：" + message.getText();
        Bukkit.getScheduler().runTask(this, () -> {
            for (Player player : Bukkit.getOnlinePlayers()) {
                player.sendMessage(Component.text(formatted));
            }
            Bukkit.getConsoleSender().sendMessage(formatted);
        });
    }
}
