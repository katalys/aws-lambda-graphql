/* eslint-disable no-console */
import { dirname, basename } from "path";

type LogFn = (msg: string, ...args: unknown[]) => void;

// Determine if one of the close parent directories is node_modules
const isInNodeModules = (() => {
    let path = dirname(dirname(__dirname));
    for (let i = 3; i--; i > 0) {
        path = dirname(path);
        if (basename(path) === "node_modules") {
            return true;
        }
    }
    return false;
})();

export type Logger = {
    log: LogFn,
    error: LogFn,
    info: LogFn,
    warn: LogFn,
    debug: LogFn,
}

/**
 * Create a sub-logger that prefixes a given namespace.
 */
export function loggerWithNs(namespace: string): Logger {
    return {
        error: console.error.bind(console, namespace),
        info: console.info.bind(console, namespace),
        log: console.log.bind(console, namespace),
        warn: console.warn.bind(console, namespace),
        debug: console.debug.bind(console, namespace),
    };
}


/**
 * Create a sub-logger that prefixes with the calling function.
 */
export function loggerFromCaller(callerFile?: string, includePackageName = isInNodeModules): Logger {
    callerFile = callerFile || getCallerFile();
    const curDir = dirname(dirname(__dirname)) + "/";
    if (callerFile.indexOf(curDir) === 0) {
        callerFile = callerFile.substr(curDir.length);
        if (includePackageName) {
            // prefix with one-directory-up path
            callerFile = `${basename(dirname(curDir))}/${callerFile}`
        }
    }
    return loggerWithNs(callerFile);
}

/**
 * Get name of file that has called into this file.
 */
function getCallerFile(): string {
    try {
        const stack = getStackTrace(getCallerFile);
        for (; ;) {
            const item = stack.shift();
            if (!item) {
                return "";
            }
            const callerfile = item.getFileName();
            if (callerfile && __filename !== callerfile) {
                return callerfile;
            }
        }
    } catch (err: any) {
        return `<error generating stack: ${err.message}`;
    }
}

/**
 * Generate a stack trace.
 *
 * @param belowFn Capture frames below this function
 * @param limit Max length of the stack
 */
// eslint-disable-next-line @typescript-eslint/ban-types
function getStackTrace(belowFn?: Function, limit = 3): NodeJS.CallSite[] {
    const dummyObject = { stack: undefined };
    const oldLimit = Error.stackTraceLimit;
    const oldHandler = Error.prepareStackTrace;

    try {
        Error.stackTraceLimit = limit;
        Error.prepareStackTrace = (dummyObject, v8StackTrace) => v8StackTrace;
        Error.captureStackTrace(dummyObject, belowFn || arguments.callee);
        return dummyObject.stack || [];
    } finally {
        Error.stackTraceLimit = oldLimit;
        Error.prepareStackTrace = oldHandler;
    }
}
