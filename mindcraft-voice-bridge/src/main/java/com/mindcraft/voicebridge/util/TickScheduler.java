package com.mindcraft.voicebridge.util;

import org.bukkit.Bukkit;
import org.bukkit.plugin.Plugin;

public final class TickScheduler {

    private TickScheduler() {
    }

    public static void runSync(Plugin plugin, Runnable runnable) {
        if (Bukkit.isPrimaryThread()) {
            runnable.run();
            return;
        }
        Bukkit.getScheduler().runTask(plugin, runnable);
    }
}
