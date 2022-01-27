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
    const operation: GQLEvent<CLIENT_EVENT_TYPES> = JSON.parse(body);

    if (typeof operation !== "object" || operation == null) {
        throw new MalformedOperationError();
    }

    if (operation.type == null) {
        throw new MalformedOperationError("Type is missing");
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

    throw new InvalidOperationError(
        "Only GQL_CONNECTION_INIT, GQL_CONNECTION_TERMINATE, GQL_START or GQL_STOP operations are accepted",
    );
}
