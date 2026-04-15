export class PcmAudioFrameChunker {
    constructor({ sampleRate = 48000, channels = 1, frameDurationMs = 20 }) {
        this.sampleRate = sampleRate;
        this.channels = channels;
        this.frameDurationMs = frameDurationMs;

        const frameSamples = sampleRate * frameDurationMs / 1000;
        if (!Number.isInteger(frameSamples)) {
            throw new Error(`无效的帧时长：${frameDurationMs}ms @ ${sampleRate}Hz`);
        }

        this.frameBytes = frameSamples * channels * 2;
        this.remainder = Buffer.alloc(0);
    }

    push(buffer) {
        if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
            return [];
        }

        const merged = this.remainder.length > 0 ? Buffer.concat([this.remainder, buffer]) : buffer;
        const frames = [];
        let offset = 0;

        while (merged.length - offset >= this.frameBytes) {
            frames.push(Buffer.from(merged.subarray(offset, offset + this.frameBytes)));
            offset += this.frameBytes;
        }

        this.remainder = Buffer.from(merged.subarray(offset));
        return frames;
    }

    flush() {
        if (this.remainder.length === 0) {
            return [];
        }

        const frame = Buffer.alloc(this.frameBytes);
        this.remainder.copy(frame);
        this.remainder = Buffer.alloc(0);
        return [frame];
    }
}
