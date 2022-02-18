import { CLIENT_EVENT_TYPES, GQLEvent, isGQLEvent, } from "../protocol";
import { ExtendableError } from "../errors";
import { APIGatewayWebSocketEvent } from "../types";

export function extractEndpointFromEvent(
    event: APIGatewayWebSocketEvent,
): string {
    return `${event.requestContext.domainName}/${event.requestContext.stage}`;
}

export class MalformedOperationError extends ExtendableError {
    constructor(reason?: string) {
        super(reason ? `Malformed operation: ${reason}` : "Malformed operation");
    }
}
export class InvalidOperationError extends ExtendableError {
    constructor(reason?: string) {
        super(reason ? `Invalid operation: ${reason}` : "Invalid operation");
    }
}

export function parseOperationFromEvent(
    { body }: APIGatewayWebSocketEvent,
): GQLEvent<CLIENT_EVENT_TYPES> {
    let operation: GQLEvent<CLIENT_EVENT_TYPES> | undefined;
    try {
        operation = JSON.parse(body);
    } catch (err) {
        // no-op
    }
    if (typeof operation !== "object" || operation == null) {
        throw new MalformedOperationError("body is not a JSON object");
    }

    const { type } = operation;
    if (!type) {
        throw new MalformedOperationError("body.type is empty");
    }

    if (
        isGQLEvent(CLIENT_EVENT_TYPES.GQL_STOP, operation)
      || isGQLEvent(CLIENT_EVENT_TYPES.GQL_CONNECTION_INIT, operation)
      || isGQLEvent(CLIENT_EVENT_TYPES.GQL_CONNECTION_TERMINATE, operation)
    ) {
        return operation;
    }

    if (isGQLEvent(CLIENT_EVENT_TYPES.GQL_START, operation)) {
        if (operation.id == null) {
            throw new MalformedOperationError("Property id is missing");
        }

        if (typeof operation.payload !== "object" || operation.payload == null) {
            throw new MalformedOperationError(
                "Property payload is missing or is not an object",
            );
        }

        return operation;
        // return {
        //     ...operation.payload,
        //     operationId: operation.id,
        // };
    }

    throw new InvalidOperationError("unknown body.type value");
}
