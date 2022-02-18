import { Server, ServerConfig } from "./Server";
import {
    CLIENT_EVENT_TYPES,
    formatGqlError,
    formatMessage,
    isGQLEvent,
    SERVER_EVENT_TYPES
} from "./protocol";
import {
    APIGatewayWebSocketEvent,
    IConnection,
    IConnectionManager,
    IdentifiedOperationRequest,
    ISubscriptionManager
} from "./types";
import { APIGatewayProxyResult, Context as LambdaContext, } from "aws-lambda";
import {
    extractEndpointFromEvent,
    isAsyncIterable,
    loggerFromCaller,
    parseOperationFromEvent,
    withTimeout
} from "./helpers";
import { ExecutionResult } from "graphql";

const logger = loggerFromCaller(__filename);

/**
 * Router for incoming AWS APIGateway V2 WebSocket events.
 */
export class WebSocketEventHandler {
    private readonly connectionManager: IConnectionManager;
    private readonly subscriptionManager: ISubscriptionManager;

    constructor(
        private readonly server: Server,
        private readonly options: NonNullable<ServerConfig<any>["subscriptions"]> = {},
    ) {
        this.connectionManager = server.connectionManager;
        this.subscriptionManager = server.subscriptionManager;
    }

    /**
     * WebSocket handler is responsible for processing AWS API Gateway v2 events
     */
    async handle(event: APIGatewayWebSocketEvent, context: LambdaContext): Promise<APIGatewayProxyResult> {
        try {
            const { routeKey } = event.requestContext;
            let response: undefined | string | APIGatewayProxyResult;

            // based on routeKey, do action
            if (this.options.debug) {
                logger.debug(`Handling ApiGateway WebSocket.${routeKey}`);
            }
            switch (routeKey) {
                case "$connect":
                    response = await this.onWebSocketConnect(event, context);
                    break;
                case "$disconnect":
                    response = await this.onWebSocketDisconnect(event, context);
                    break;
                case "$default":
                    response = await this.onWebSocketEvent(event, context);
                    break;
                default:
                    throw new Error(`Invalid event ${routeKey} received`);
            }

            if (typeof response !== "object") {
                response = {
                    body: response,
                    statusCode: 200,
                };
            }
            if (this.options.debug) {
                logger.debug(`WebSocket.${routeKey} response:`, response);
            }
            return response;

        } catch (err: any) {
            if (err instanceof ProhibitedError) {
                logger.warn("Connection rejected", err);
                return {
                    body: formatGqlError(err.message || "Prohibited action"),
                    statusCode: 401,
                }
            }

            logger.error("Server Error", err);
            return {
                body: err.message || "Internal server error",
                statusCode: 500,
            };
        }
    }

    async onWebSocketConnect(event: APIGatewayWebSocketEvent<"$connect">, lambdaContext: LambdaContext): Promise<APIGatewayProxyResult> {
        const { onWebsocketConnect, connectionEndpoint } =
            this.options;

        // register connection
        // if error is thrown during registration, connection is rejected
        // we can implement some sort of authorization here
        const endpoint =
            connectionEndpoint || extractEndpointFromEvent(event);

        const connection = await this.connectionManager.registerConnection({
            endpoint,
            connectionId: event.requestContext.connectionId,
        });

        let newConnectionContext = {};

        if (onWebsocketConnect) {
            try {
                const result = await withTimeout(15000, onWebsocketConnect(
                    connection,
                    event,
                    lambdaContext,
                ));

                if (result === false) {
                    throw new ProhibitedError("Prohibited connection!");
                }
                if (result != null && typeof result === "object") {
                    newConnectionContext = result;
                }
            } catch (err) {
                await this.connectionManager.unregisterConnection(connection);

                throw err;
            }
        }

        // set connection context which will be available during graphql execution
        const connectionData = {
            ...connection.data,
            context: newConnectionContext,
        };

        await this.connectionManager.setConnectionData(
            connection,
            connectionData,
        );

        return {
            body: "",
            headers: event.headers?.["Sec-WebSocket-Protocol"]?.includes(
                "graphql-ws",
            )
                ? {
                    "Sec-WebSocket-Protocol": "graphql-ws",
                }
                : undefined,
            statusCode: 200,
        };
    }


    async onWebSocketDisconnect(event: APIGatewayWebSocketEvent<"$disconnect">, lambdaContext: LambdaContext): Promise<string> {
        // this event is called eventually by AWS APIGateway v2
        // we actually don't care about a result of this operation because client is already
        // disconnected, it is meant only for clean up purposes
        // hydrate connection
        const connection = await this.connectionManager.hydrateConnection(
            event.requestContext.connectionId,
        );

        const { onDisconnect } = this.options;
        if (onDisconnect) {
            try {
                await withTimeout(15000, onDisconnect(connection));
            } catch (err) {
                logger.error("Failed onDisconnect:", err);
            }
        }

        await this.connectionManager.unregisterConnection(connection);

        return "";
    }

    async onWebSocketEvent(event: APIGatewayWebSocketEvent<"$default">, lambdaContext: LambdaContext): Promise<string> {
        // here we are processing messages received from a client
        // if we respond here and the route has integration response assigned
        // it will send the body back to client, so it is easy to respond with operation results
        const { connectionId } = event.requestContext;
        const {
            waitForInitialization: {
                retryCount: waitRetryCount = 10,
                timeout: waitTimeout = 50,
            } = {},
        } = this.options;

        // parse operation from body
        const operation = parseOperationFromEvent(event);

        // hydrate connection
        let connection = await this.connectionManager.hydrateConnection(
            connectionId,
            {
                retryCount: 1,
                timeout: waitTimeout,
            },
        );

        if (!connection.data.isInitialized && !isGQLEvent(CLIENT_EVENT_TYPES.GQL_CONNECTION_INIT, operation)) {
            // wait for connection to be initialized
            for (let i = 0; i <= waitRetryCount; i++) {
                const freshConnection = await this.connectionManager.hydrateConnection(connectionId);

                if (freshConnection.data.isInitialized) {
                    connection = freshConnection;
                } else if (i + 1 <= waitRetryCount) {
                    // wait for another round
                    await new Promise(resolve => setTimeout(resolve, waitTimeout));
                }
            }

            if (!connection.data.isInitialized) {
                // refuse connection which did not send GQL_CONNECTION_INIT operation
                const errorResponse = formatGqlError("Prohibited connection!");

                await this.connectionManager.sendToConnection(
                    connection,
                    errorResponse,
                );
                await this.connectionManager.closeConnection(connection);

                throw new ProhibitedError("Not initialized");
            }
        }

        if (isGQLEvent(CLIENT_EVENT_TYPES.GQL_CONNECTION_INIT, operation)) {
            return this.onConnectionInit(connection, lambdaContext, operation.payload);
        } else if (isGQLEvent(CLIENT_EVENT_TYPES.GQL_CONNECTION_TERMINATE, operation)) {
            return this.onConnectionTerminate(connection);
        } else if (isGQLEvent(CLIENT_EVENT_TYPES.GQL_STOP, operation)) {
            return this.onConnectionStop(connection, operation.id);
        } else if (isGQLEvent(CLIENT_EVENT_TYPES.GQL_START, operation)) {
            const op: IdentifiedOperationRequest = {
                ...operation.payload,
                operationId: operation.id,
            };
            return this.onConnectionStart(connection, op, event, lambdaContext);
        } else {
            throw new ProhibitedError(`Bad event type`);
        }
    }

    async onConnectionInit(connection: IConnection, lambdaContext: LambdaContext, context?: any) {
        const { onConnect } = this.options;

        if (onConnect) {
            try {
                const result = await onConnect(
                    context,
                    connection,
                    //event,
                    //lambdaContext,
                );

                if (result === false) {
                    throw new Error("Prohibited connection!");
                }
                if (result !== null && typeof result === "object") {
                    context = result;
                }
            } catch (err: any) {
                const errorResponse = formatGqlError(err.message);

                await this.connectionManager.sendToConnection(
                    connection,
                    errorResponse,
                );
                await this.connectionManager.closeConnection(connection);

                throw new ProhibitedError(err.message);
            }
        }

        // set connection context which will be available during graphql execution
        const connectionData = {
            ...connection.data,
            context: {
                ...connection.data?.context,
                ...context,
            },
            isInitialized: true,
        };

        await this.connectionManager.setConnectionData(
            connection,
            connectionData,
        );

        // send GQL_CONNECTION_INIT message to client
        const response = formatMessage({
            type: SERVER_EVENT_TYPES.GQL_CONNECTION_ACK,
        });

        await this.connectionManager.sendToConnection(
            connection,
            response,
        );

        return response;
    }

    async onConnectionStop(connection: IConnection, operationId: string) {
        const { onOperationComplete } = this.options;

        // unsubscribe client
        if (onOperationComplete) {
            onOperationComplete(connection, operationId);
        }
        const response = formatMessage({
            id: operationId,
            type: SERVER_EVENT_TYPES.GQL_COMPLETE,
        });

        await this.connectionManager.sendToConnection(
            connection,
            response,
        );

        await this.subscriptionManager.unsubscribeOperation(
            connection.id,
            operationId,
        );

        return response;
    }

    async onConnectionTerminate(connection?: IConnection) {
        // unregisterConnection will be handled by $disconnect, return straightaway
        return "";
    }

    async onConnectionStart(connection: IConnection, operation: IdentifiedOperationRequest, event: any, lambdaContext: LambdaContext) {
        const result = await this.server.execute({
            connection,
            event,
            lambdaContext,
            operation,
            // tell execute to register subscriptions
            registerSubscriptions: true,
        });

        if (!isAsyncIterable(result)) {
            const { onOperationComplete } = this.options;
            if (onOperationComplete) {
                onOperationComplete(
                    connection,
                    operation.operationId,
                );
            }

            // send response to client so it can finish operation in case of query or mutation
            const response = formatMessage({
                id: operation.operationId,
                payload: result as ExecutionResult,
                type: SERVER_EVENT_TYPES.GQL_DATA,
            });
            await this.connectionManager.sendToConnection(
                connection,
                response,
            );

            return response;
        }

        // this is just to make sure
        // when you deploy this using serverless cli
        // then integration response is not assigned to $default route
        // so this won't make any difference
        // but the sendToConnection above will send the response to client
        // so client'll receive the response for his operation
        return "";
    }
}

class ProhibitedError extends Error {
}
