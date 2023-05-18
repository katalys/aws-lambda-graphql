"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withFilter = exports.isAsyncIterable = exports.createAsyncIterator = void 0;
if (Symbol.asyncIterator === undefined) {
    Symbol.asyncIterator = Symbol.for("asyncIterator");
}
function createAsyncIterator(collection) {
    return {
        next: async () => {
            const value = collection.shift();
            return {
                value: value,
                done: collection.length === 0
            };
        },
        [Symbol.asyncIterator]() {
            return this;
        },
    };
}
exports.createAsyncIterator = createAsyncIterator;
function isAsyncIterable(obj) {
    // return !!obj[Symbol.asyncIterator];
    return typeof obj[Symbol.asyncIterator] === "function";
}
exports.isAsyncIterable = isAsyncIterable;
/**
 * Iterate over an async-iterator filtering returned values.
 */
function withFilter(asyncIteratorFn, filterFn) {
    return async (rootValue, args, context, info) => {
        var _a, _b;
        const asyncIterator = await asyncIteratorFn(rootValue, args, context, info);
        const getNextPromise = () => {
            return asyncIterator.next().then((payload) => {
                if (payload.done === true) {
                    return payload;
                }
                return Promise.resolve(filterFn(payload.value, args, context, info)).then((filterResult) => {
                    if (filterResult === true) {
                        return payload;
                    }
                    // Skip the current value and wait for the next one
                    return getNextPromise();
                });
            });
        };
        return {
            next: getNextPromise,
            return: (_a = asyncIterator.return) === null || _a === void 0 ? void 0 : _a.bind(asyncIterator),
            throw: (_b = asyncIterator.throw) === null || _b === void 0 ? void 0 : _b.bind(asyncIterator),
            [Symbol.asyncIterator]() {
                return this;
            },
        };
    };
}
exports.withFilter = withFilter;
