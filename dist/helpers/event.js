"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseOperationFromEvent = exports.InvalidOperationError = exports.MalformedOperationError = exports.extractEndpointFromEvent = void 0;
const protocol_1 = require("../protocol");
const errors_1 = require("../errors");
function extractEndpointFromEvent(event) {
    return `${event.requestContext.domainName}/${event.requestContext.stage}`;
}
exports.extractEndpointFromEvent = extractEndpointFromEvent;
class MalformedOperationError extends errors_1.ExtendableError {
    constructor(reason) {
        super(reason ? `Malformed operation: ${reason}` : "Malformed operation");
    }
}
exports.MalformedOperationError = MalformedOperationError;
class InvalidOperationError extends errors_1.ExtendableError {
    constructor(reason) {
        super(reason ? `Invalid operation: ${reason}` : "Invalid operation");
    }
}
exports.InvalidOperationError = InvalidOperationError;
function parseOperationFromEvent({ body }) {
    let operation;
    try {
        operation = JSON.parse(body);
    }
    catch (err) {
        // no-op
    }
    if (typeof operation !== "object" || operation == null) {
        throw new MalformedOperationError("body is not a JSON object");
    }
    const { type } = operation;
    if (!type) {
        throw new MalformedOperationError("body.type is empty");
    }
    if ((0, protocol_1.isGQLEvent)("stop" /* CLIENT_EVENT_TYPES.GQL_STOP */, operation)
        || (0, protocol_1.isGQLEvent)("connection_init" /* CLIENT_EVENT_TYPES.GQL_CONNECTION_INIT */, operation)
        || (0, protocol_1.isGQLEvent)("connection_terminate" /* CLIENT_EVENT_TYPES.GQL_CONNECTION_TERMINATE */, operation)) {
        return operation;
    }
    if ((0, protocol_1.isGQLEvent)("start" /* CLIENT_EVENT_TYPES.GQL_START */, operation)) {
        if (operation.id == null) {
            throw new MalformedOperationError("Property id is missing");
        }
        if (typeof operation.payload !== "object" || operation.payload == null) {
            throw new MalformedOperationError("Property payload is missing or is not an object");
        }
        return operation;
        // return {
        //     ...operation.payload,
        //     operationId: operation.id,
        // };
    }
    throw new InvalidOperationError("unknown body.type value");
}
exports.parseOperationFromEvent = parseOperationFromEvent;
