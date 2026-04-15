function clampInt16(sample) {
    if (sample > 32767) return 32767;
    if (sample < -32768) return -32768;
    return sample;
}

function midpoint(a, b) {
    return clampInt16(Math.round((a + b) / 2));
}

function decodePcm16Le(buffer) {
    const samples = new Array(buffer.length / 2);
    for (let i = 0; i < samples.length; i += 1) {
        samples[i] = buffer.readInt16LE(i * 2);
    }
    return samples;
}

function encodePcm16Le(samples) {
    const output = Buffer.alloc(samples.length * 2);
    for (let i = 0; i < samples.length; i += 1) {
        output.writeInt16LE(clampInt16(samples[i]), i * 2);
    }
    return output;
}

export class Pcm16MonoResampler {
    constructor({ inputSampleRate = 24000, outputSampleRate = 48000 }) {
        this.inputSampleRate = Number(inputSampleRate);
        this.outputSampleRate = Number(outputSampleRate);
        this.pendingSample = null;

        if (!Number.isFinite(this.inputSampleRate) || !Number.isFinite(this.outputSampleRate)) {
            throw new Error('PCM 重采样器采样率无效。');
        }

        if (![1, 2].includes(this.outputSampleRate / this.inputSampleRate)) {
            throw new Error(`当前仅支持 1x 或 2x 采样率转换，收到 ${this.inputSampleRate} -> ${this.outputSampleRate}`);
        }
    }

    push(buffer) {
        if (!Buffer.isBuffer(buffer)) {
            throw new Error('PCM 重采样器仅支持 Buffer 输入。');
        }
        if (buffer.length === 0) {
            return Buffer.alloc(0);
        }
        if (buffer.length % 2 !== 0) {
            throw new Error('PCM 数据长度必须是 2 的倍数。');
        }

        if (this.inputSampleRate === this.outputSampleRate) {
            return Buffer.from(buffer);
        }

        const samples = decodePcm16Le(buffer);
        const output = [];

        if (this.pendingSample !== null && samples.length > 0) {
            output.push(this.pendingSample, midpoint(this.pendingSample, samples[0]));
        }

        for (let i = 0; i < samples.length - 1; i += 1) {
            output.push(samples[i], midpoint(samples[i], samples[i + 1]));
        }

        if (samples.length > 0) {
            this.pendingSample = samples[samples.length - 1];
        }

        return encodePcm16Le(output);
    }

    flush() {
        if (this.inputSampleRate === this.outputSampleRate || this.pendingSample === null) {
            this.pendingSample = null;
            return Buffer.alloc(0);
        }

        const output = encodePcm16Le([this.pendingSample, this.pendingSample]);
        this.pendingSample = null;
        return output;
    }
}
