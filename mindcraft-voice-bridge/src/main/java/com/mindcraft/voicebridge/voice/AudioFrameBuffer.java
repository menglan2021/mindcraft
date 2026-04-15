package com.mindcraft.voicebridge.voice;

import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

public class AudioFrameBuffer {

    private final LinkedBlockingQueue<short[]> frames = new LinkedBlockingQueue<>();
    private volatile boolean ended;
    private volatile boolean cancelled;

    public void offer(short[] frame) {
        if (!cancelled) {
            frames.offer(frame);
        }
    }

    public void markEnded() {
        this.ended = true;
    }

    public void cancel() {
        this.cancelled = true;
        this.frames.clear();
    }

    public short[] nextFrame(int timeoutMs, int frameSamples) {
        if (cancelled) {
            return null;
        }

        try {
            short[] frame = frames.poll(timeoutMs, TimeUnit.MILLISECONDS);
            if (frame != null) {
                return frame;
            }
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            return null;
        }

        if (cancelled || ended) {
            return null;
        }

        return new short[frameSamples];
    }
}
