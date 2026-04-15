export function createAbortError(message = '操作已取消。') {
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
}

export function isAbortError(error) {
    return error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
}

function resolveAbortReason(signal, fallbackMessage) {
    const reason = signal?.reason;
    if (reason instanceof Error) {
        return reason;
    }
    if (typeof reason === 'string' && reason.trim() !== '') {
        return createAbortError(reason);
    }
    return createAbortError(fallbackMessage);
}

export class StreamQueue {
    constructor(name = 'stream') {
        this.name = name;
        this.entries = [];
        this.current = null;
        this.processing = false;
        this.idleResolvers = [];
    }

    enqueue(taskFactory) {
        return new Promise((resolve, reject) => {
            this.entries.push({
                controller: new AbortController(),
                taskFactory,
                resolve,
                reject,
            });
            this.#process().catch((error) => {
                console.error(`[${this.name}] queue failed`, error);
            });
        });
    }

    cancelCurrent(message = `${this.name} 当前任务已取消。`) {
        if (!this.current) return;
        this.current.controller.abort(createAbortError(message));
    }

    cancelAll(message = `${this.name} 队列已取消。`) {
        this.cancelCurrent(message);
        while (this.entries.length > 0) {
            const entry = this.entries.shift();
            entry.controller.abort(createAbortError(message));
            entry.resolve(null);
        }
        this.#resolveIdleIfNeeded();
    }

    async waitForIdle() {
        if (!this.processing && !this.current && this.entries.length === 0) {
            return;
        }
        await new Promise((resolve) => this.idleResolvers.push(resolve));
    }

    async #process() {
        if (this.processing) return;
        this.processing = true;

        try {
            while (this.entries.length > 0) {
                const entry = this.entries.shift();
                this.current = entry;

                try {
                    const result = await entry.taskFactory({ signal: entry.controller.signal });
                    entry.resolve(result ?? null);
                } catch (error) {
                    if (entry.controller.signal.aborted || isAbortError(error)) {
                        entry.resolve(null);
                    } else {
                        entry.reject(error);
                    }
                } finally {
                    this.current = null;
                }
            }
        } finally {
            this.processing = false;
            this.#resolveIdleIfNeeded();
        }
    }

    #resolveIdleIfNeeded() {
        if (this.processing || this.current || this.entries.length > 0) {
            return;
        }
        while (this.idleResolvers.length > 0) {
            const resolve = this.idleResolvers.shift();
            resolve();
        }
    }
}

export function throwIfAborted(signal, fallbackMessage = '操作已取消。') {
    if (signal?.aborted) {
        throw resolveAbortReason(signal, fallbackMessage);
    }
}
