package com.mindcraft.voicebridge.util;

import java.util.Base64;

public final class Base64Audio {

    private Base64Audio() {
    }

    public static byte[] decode(String value) {
        return Base64.getDecoder().decode(value);
    }
}
