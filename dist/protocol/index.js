"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatGqlError = exports.formatMessage = exports.isGQLEvent = void 0;
function isGQLEvent(type, event) {
    const found = event && typeof event === "object" && event.type;
    return found === type || (type === "start" /* CLIENT_EVENT_TYPES.GQL_START */
        && found === "subscribe" // protocol change
    ) || (type === "stop" /* CLIENT_EVENT_TYPES.GQL_STOP */
        && found === "complete" // protocol change
    ) || (type === "next" /* SERVER_EVENT_TYPES.GQL_DATA */
        && found === "data" // old alias
    );
}
exports.isGQLEvent = isGQLEvent;
function formatMessage(event) {
    return JSON.stringify(event);
}
exports.formatMessage = formatMessage;
function formatGqlError(message) {
    return formatMessage({
        type: "error" /* SERVER_EVENT_TYPES.GQL_ERROR */,
        payload: { message },
    });
}
exports.formatGqlError = formatGqlError;
