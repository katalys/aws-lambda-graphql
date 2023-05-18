"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sleep = exports.PromiseTimeoutError = exports.withTimeout = exports.isTTLExpired = exports.computeTTL = void 0;
/**
 * Computes TTL in UNIX timestamp with seconds precision
 */
function computeTTL(ttl) {
    if (!ttl || ttl < 2) {
        return undefined;
    }
    return Math.round(Date.now() / 1000 + ttl);
}
exports.computeTTL = computeTTL;
function isTTLExpired(ttl, defaultIfMissing = false) {
    return ttl ? ttl * 1000 < Date.now() : defaultIfMissing;
}
exports.isTTLExpired = isTTLExpired;
/**
 * After `timeoutMs`, either run `cb()` or throw an Error named `PROMISE_TIMEOUT`.
 */
async function withTimeout(timeoutMs = 30000, promise, cb) {
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
        return ret;
    }
    // Callback provided, so exec callback and wait
    if (cb) {
        cb();
        return promise;
    }
    // No callback provided, so throw Error
    throw new PromiseTimeoutError(`Promise timed out after ${timeoutMs}ms`);
}
exports.withTimeout = withTimeout;
class PromiseTimeoutError extends Error {
    constructor() {
        super(...arguments);
        this.name = "PROMISE_TIMEOUT";
    }
}
exports.PromiseTimeoutError = PromiseTimeoutError;
/**
 * Resolve with `value` after `ms` milliseconds.
 */
function sleep(ms, value) {
    let to, finish;
    const p = new Promise(resolve => {
        finish = () => {
            resolve(value);
        };
        to = setTimeout(finish, ms);
    });
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
exports.sleep = sleep;
