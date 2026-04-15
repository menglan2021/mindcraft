package com.mindcraft.voicebridge.util;

import java.util.logging.Logger;

public final class Loggers {

    private Loggers() {
    }

    public static void info(Logger logger, String message) {
        logger.info("[MindcraftVoiceBridge] " + message);
    }

    public static void warn(Logger logger, String message) {
        logger.warning("[MindcraftVoiceBridge] " + message);
    }
}
