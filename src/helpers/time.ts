/**
 * Computes TTL in UNIX timestamp with seconds precision
 */
export function computeTTL(ttl?: number | false): number | undefined {
    if (!ttl || ttl < 2) {
        return undefined;
    }
    return Math.round(Date.now() / 1000 + ttl);
}

export function isTTLExpired(ttl?: null | undefined | false | number, defaultIfMissing = false): boolean {
    return ttl ? ttl * 1000 < Date.now() : defaultIfMissing;
}


/**
 * After `timeoutMs`, either run `cb()` or throw an Error named `PROMISE_TIMEOUT`.
 */
export async function withTimeout<T>(
    timeoutMs = 30000,
    promise: T,
    cb?: () => void,
): Promise<T> {
    if (!(promise instanceof Promise)) {
        return promise;
    }

    // Create unique object reference
    const uniqueRef = {};
    const sleepPromise = sleep(timeoutMs, uniqueRef);

    const ret = await Promise.race([promise, sleepPromise]);

    // Promise finished first, so cancel sleep and return
    if (ret !== uniqueRef) {
        sleepPromise.cancel();
        return ret as T;
    }

    // Callback provided, so exec callback and wait
    if (cb) {
        cb();
        return promise;
    }

    // No callback provided, so throw Error
    throw new PromiseTimeoutError(`Promise timed out after ${timeoutMs}ms`);
}

export class PromiseTimeoutError extends Error {
  name = "PROMISE_TIMEOUT";
}

export function sleep(ms: number): SleepPromise<void>;
export function sleep<T>(ms: number, value: T): SleepPromise<T>;
/**
 * Resolve with `value` after `ms` milliseconds.
 */
export function sleep<T = void>(ms: number, value?: T): SleepPromise<T | void> {
    let to: NodeJS.Timeout | undefined,
        finish: () => void;
    const p = new Promise<T | undefined>(resolve => {
        finish = () => {
            resolve(value);
        };
        to = setTimeout(finish, ms);
    }) as SleepPromise<T>;
    p.cancel = () => {
        if (to) {
            clearTimeout(to);
            to = undefined;
            return true;
        }
        return false;
    };
    p.skip = () => {
        if (to) {
            clearTimeout(to);
            to = undefined;
            finish();
            return true;
        }
        return false;
    };
    // Seems helpful at first, but no effect w/ async/await ...
    // p.unref = () => {
    //     if (to) {
    //         to.unref();
    //     }
    //     return p;
    // };
    return p;
}

type SleepPromise<T> = Promise<T> & {
  cancel(): boolean;
  skip(): boolean;
  // unref(): SleepPromise<T>;
  // ^^^ never works because await() will keep process open!
};
