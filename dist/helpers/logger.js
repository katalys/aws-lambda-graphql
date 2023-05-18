"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loggerFromCaller = exports.loggerWithNs = void 0;
/* eslint-disable no-console */
const path_1 = require("path");
// Determine if one of the close parent directories is node_modules
const isInNodeModules = (() => {
    let path = (0, path_1.dirname)((0, path_1.dirname)(__dirname));
    for (let i = 3; i--; i > 0) {
        path = (0, path_1.dirname)(path);
        if ((0, path_1.basename)(path) === "node_modules") {
            return true;
        }
    }
    return false;
})();
/**
 * Create a sub-logger that prefixes a given namespace.
 */
function loggerWithNs(namespace) {
    return {
        error: console.error.bind(console, namespace),
        info: console.info.bind(console, namespace),
        log: console.log.bind(console, namespace),
        warn: console.warn.bind(console, namespace),
        debug: console.debug.bind(console, namespace),
    };
}
exports.loggerWithNs = loggerWithNs;
/**
 * Create a sub-logger that prefixes with the calling function.
 */
function loggerFromCaller(callerFile, includePackageName = isInNodeModules) {
    callerFile = callerFile || getCallerFile();
    const curDir = (0, path_1.dirname)((0, path_1.dirname)(__dirname)) + "/";
    if (callerFile.indexOf(curDir) === 0) {
        callerFile = callerFile.substr(curDir.length);
        if (includePackageName) {
            // prefix with one-directory-up path
            callerFile = `${(0, path_1.basename)((0, path_1.dirname)(curDir))}/${callerFile}`;
        }
    }
    return loggerWithNs(callerFile);
}
exports.loggerFromCaller = loggerFromCaller;
/**
 * Get name of file that has called into this file.
 */
function getCallerFile() {
    try {
        const stack = getStackTrace(getCallerFile);
        for (;;) {
            const item = stack.shift();
            if (!item) {
                return "";
            }
            const callerfile = item.getFileName();
            if (callerfile && __filename !== callerfile) {
                return callerfile;
            }
        }
    }
    catch (err) {
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
function getStackTrace(belowFn, limit = 3) {
    const dummyObject = { stack: undefined };
    const oldLimit = Error.stackTraceLimit;
    const oldHandler = Error.prepareStackTrace;
    try {
        Error.stackTraceLimit = limit;
        Error.prepareStackTrace = (dummyObject, v8StackTrace) => v8StackTrace;
        Error.captureStackTrace(dummyObject, belowFn || arguments.callee);
        return dummyObject.stack || [];
    }
    finally {
        Error.stackTraceLimit = oldLimit;
        Error.prepareStackTrace = oldHandler;
    }
}
