"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArrayPubSub = void 0;
const helpers_1 = require("./helpers");
/**
 * Array PubSub works as local PubSub that is already fed with all the events that were published
 *
 * Each time you call asyncIterator it will create an iterator that iterates over events
 *
 * This PubSub instance is used internally in event processor to simulate
 * source of events. Basically it acts as you were publishing events,
 * which were loaded from event store.
 *
 * If event payload is string, then it's parsed from JSON, otherwise it's used
 * as is and sent to your GraphQL schema.
 */
class ArrayPubSub {
    constructor(events) {
        this.events = events;
    }
    async publish() {
        throw new Error("ArrayPubSub is read only");
    }
    async subscribe() {
        throw new Error("Please do not use this PubSub implementation");
    }
    async unsubscribe() {
        throw new Error("Please do not use this PubSub implementation");
    }
    asyncIterator(eventNames) {
        const names = Array.isArray(eventNames) ? eventNames : [eventNames];
        return (0, helpers_1.createAsyncIterator)(this.events
            .filter((event) => names.includes(event.event))
            .map((event) => typeof event.payload === "string"
            ? JSON.parse(event.payload)
            : event.payload));
    }
}
exports.ArrayPubSub = ArrayPubSub;
