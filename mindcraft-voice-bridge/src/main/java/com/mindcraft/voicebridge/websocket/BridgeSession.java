package com.mindcraft.voicebridge.websocket;

import org.java_websocket.WebSocket;

public record BridgeSession(WebSocket connection, String remoteAddress) {
}
