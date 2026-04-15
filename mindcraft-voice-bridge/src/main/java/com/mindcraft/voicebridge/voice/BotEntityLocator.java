package com.mindcraft.voicebridge.voice;

import org.bukkit.Bukkit;
import org.bukkit.entity.Player;

public class BotEntityLocator {

    public Player findOnlinePlayer(String name) {
        Player exact = Bukkit.getPlayerExact(name);
        if (exact != null && exact.isOnline()) {
            return exact;
        }

        for (Player player : Bukkit.getOnlinePlayers()) {
            if (player.getName().equalsIgnoreCase(name)) {
                return player;
            }
        }

        return null;
    }
}
