import { loggerFromCaller } from "./logger";
import { sleep } from "./time";

const logger = loggerFromCaller(__filename);

/**
 * Attempt to run an async function with exponential-backup retries.
 *
 * @param func Function to execute
 * @param config Backoff configuration
 */
export async function retryFunc<T>(
    func: () => T,
    config: number | {
        onFail?: (err: Error, remaining: number) => void,
        // Initial interval. It will eventually go as high as maxInterval.
        initialInterval?: number;
        // Maximum number of retry attempts.
        maxRetries?: number;
        // Maximum delay between retries.
        maxInterval?: number;
        // Conditional retry.
        shouldRetry?: (error: any|Error) => boolean;
        backoffDelay?: (iteration: number, initialInterval: number) => number;
        logContext?: string;
    } = 2,
): Promise<T> {
    const {
        onFail = null,
        initialInterval = 800, // normal interval
        maxRetries = 2,        // number of waits
        maxInterval = 30*1000, // never wait longer than this
        shouldRetry = () => true, // filter attempts
        backoffDelay = (iteration: number, initialInterval: number) =>
            Math.pow(2, iteration) * initialInterval
            // apply jitter
            + (Math.random() * .9 - .45) * initialInterval,
        logContext = func.name || "anon",
    } = typeof config === "number" ? { maxRetries: config } : config;

    for (let i = 0; ; i++) {
        try {
            return await func();
        } catch (error: any) {
            if (onFail) {
                onFail(error, maxRetries - i - 1);
            }

            if (i < maxRetries && shouldRetry(error)) {
                const ms = Math.round(Math.min(backoffDelay(i, initialInterval), maxInterval));
                logger.warn(`[RETRYING] ${logContext} attempt#${i+1} of ${maxRetries+1}, retry in ${ms}ms`, { error });
                await sleep(ms);
                continue;
            }

            logger.error(`[FAIL] ${logContext} after ${maxRetries+1} attempts: ${error.message||error}`, { error });
            throw error;
        }
    }
}