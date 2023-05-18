"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PubSub = void 0;
const assert_1 = __importDefault(require("assert"));
class PubSub {
    constructor({ eventStore, serializeEventPayload = true, }) {
        assert_1.default.ok(eventStore && typeof eventStore === "object", "Please provide eventStore as an instance implementing IEventStore");
        assert_1.default.ok(typeof serializeEventPayload === "boolean", "Please provide serializeEventPayload as a boolean");
        this.eventStore = eventStore;
        this.serializeEventPayload = serializeEventPayload;
    }
    subscribe(eventNames) {
        return async (rootValue, args, { $$internal }) => {
            const { connection, operation, pubSub, registerSubscriptions, subscriptionManager, } = $$internal;
            const names = Array.isArray(eventNames) ? eventNames : [eventNames];
            if (pubSub == null) {
                throw new Error("`pubSub` is not provided in context");
            }
            // register subscriptions only if it set to do so
            // basically this means that client sent subscription operation over websocket
            if (registerSubscriptions) {
                if (connection == null) {
                    throw new Error("`connection` is not provided in context");
                }
                await subscriptionManager.subscribe(names, connection, 
                // this is called only on subscription so operationId should be filled
                operation);
            }
            return pubSub.asyncIterator(names);
        };
    }
    /**
     * Notice that this propagates event through storage
     * So you should not expect to fire in same process
     */
    publish(eventName, payload) {
        if (typeof eventName !== "string" || !eventName) {
            throw new Error("Event name must be nonempty string");
        }
        return this.eventStore.publish({
            payload: this.serializeEventPayload ? JSON.stringify(payload) : payload,
            event: eventName,
        });
    }
}
exports.PubSub = PubSub;
