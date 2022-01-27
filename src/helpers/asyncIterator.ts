// polyfill Symbol.asyncIterator
import { IContext, SubscribeResolveFn } from "../types";
import { GraphQLResolveInfo } from "graphql";

if (Symbol.asyncIterator === undefined) {
    (Symbol as any).asyncIterator = Symbol.for("asyncIterator");
}

export function createAsyncIterator<T = any>(collection: T[]): AsyncIterator<T> & AsyncIterable<T> {
    return {
        next: async () => {
            const value = collection.shift();
            return {
                value: value as T,
                done: collection.length === 0
            };
        },
        [Symbol.asyncIterator]() {
            return this;
        },
    };
}

export function isAsyncIterable(obj: any): obj is AsyncIterable<any> {
    // return !!obj[Symbol.asyncIterator];
    return typeof obj[Symbol.asyncIterator] === "function";
}

export type FilterFn = (
    rootValue?: any,
    args?: any,
    context?: IContext,
    info?: GraphQLResolveInfo,
) => boolean | Promise<boolean>;

/**
 * Iterate over an async-iterator filtering returned values.
 */
export function withFilter(
    asyncIteratorFn: SubscribeResolveFn,
    filterFn: FilterFn,
): SubscribeResolveFn {
    return async (rootValue, args, context, info) => {
        const asyncIterator = await asyncIteratorFn(rootValue, args, context, info);

        const getNextPromise = (): Promise<IteratorResult<any>> => {
            return asyncIterator.next().then((payload) => {
                if (payload.done === true) {
                    return payload;
                }

                return Promise.resolve(
                    filterFn(payload.value, args, context, info),
                ).then((filterResult) => {
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
            return: asyncIterator.return?.bind(asyncIterator),
            throw: asyncIterator.throw?.bind(asyncIterator),
            [Symbol.asyncIterator]() {
                return this;
            },
        } as AsyncIterator<any> & AsyncIterable<any>;
    };
}
