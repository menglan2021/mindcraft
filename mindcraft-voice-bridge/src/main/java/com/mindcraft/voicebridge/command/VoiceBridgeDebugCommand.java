package com.mindcraft.voicebridge.command;

import com.mindcraft.voicebridge.MindcraftVoiceBridgePlugin;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;

public class VoiceBridgeDebugCommand implements CommandExecutor {

    private final MindcraftVoiceBridgePlugin plugin;

    public VoiceBridgeDebugCommand(MindcraftVoiceBridgePlugin plugin) {
        this.plugin = plugin;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (args.length > 0 && "reload".equalsIgnoreCase(args[0])) {
            plugin.reloadPluginConfiguration();
            sender.sendMessage("MindcraftVoiceBridge 配置已重载。");
            return true;
        }

        sender.sendMessage("MindcraftVoiceBridge 状态: " + plugin.getStatusSummary());
        return true;
    }
}
