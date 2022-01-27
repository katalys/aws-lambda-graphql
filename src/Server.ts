/* eslint-disable @typescript-eslint/ban-types */
import {
    ApolloServer,
    Config,
    CreateHandlerOptions,
} from "apollo-server-lambda";
import assert from "assert";
import {
    Context as LambdaContext, Handler,
} from "aws-lambda";
import {
    APIGatewayWebSocketEvent,
    IConnectionManager,
    IContext,
    ISubscriptionManager,
    IConnection,
    OperationRequest,
} from "./types";
import { execute, ExecuteOptions, ExecutionParams } from "./execute";
import { WebSocketEventHandler } from "./WebSocketEventHandler";
import { DynamoDBStreamHandler } from "./DynamoDBStreamHandler";
import { ArrayPubSub } from "./ArrayPubSub";
import { SQSEventHandler } from "./SQSEventHandler";

export interface ServerConfig<TServer extends object> extends Omit<Config, "context" | "subscriptions"> {
    /**
     * Connection manager takes care of
     *  - registering/unregistering WebSocket src
     *  - sending data to src
     */
    connectionManager: IConnectionManager;
    context?: object | ((contextParams: IContext) => object | Promise<object>);
    /**
     * Use to report errors from web socket handler
     */
    onError?: (err: any) => void;
    /**
     * Subscriptions manager takes care of
     *  - registering/unregistering connection's subscribed operations
     */
    subscriptionManager: ISubscriptionManager;
    subscriptions?: {
        /**
         * handlerTimeout is milliseconds to wait for any of these operation handlers.
         */
        handlerTimeout?: number;

        onOperation?: (
            message: OperationRequest,
            params: ExecutionParams,
            connection: IConnection,
        ) => Promise<ExecutionParams> | ExecutionParams;
        onOperationComplete?: (
            connection: IConnection,
            operationId: string,
        ) => void;
        /**
         * onWebsocketConnect is called when the Websocket connection is initialized ($connect route).
         * Return an object to set a context to your connection object saved in the database e.g. for saving authentication details.
         * This is especially useful to get authentication details (API GW authorizers only run in $connect route)
         *
         */
        onWebsocketConnect?: (
            connection: IConnection,
            event: APIGatewayWebSocketEvent,
            context: LambdaContext,
        ) =>
            | Promise<boolean | { [key: string]: any }>
            | boolean
            | { [key: string]: any };
        /**
         * onConnect is called when the GraphQL connection is initialized (connection_init message).
         * Return an object to set a context to your connection object saved in the database e.g. for saving authentication details.
         *
         * NOTE: This is not the websocket $connect route, see onWebsocketConnect for the $connect route
         *
         */
        onConnect?: (
            messagePayload: { [key: string]: any } | undefined | null,
            connection: IConnection,
            //event: APIGatewayWebSocketEvent,
            //context: LambdaContext,
        ) =>
            | Promise<boolean | { [key: string]: any }>
            | boolean
            | { [key: string]: any };
        onDisconnect?: (connection: IConnection) => void;
        /**
         * If connection is not initialized on GraphQL operation, wait for connection to be initialized
         * Or throw prohibited connection error
         *
         */
        waitForInitialization?: {
            /**
             * How many times should we try to determine connection state?
             *
             * Default is 10
             */
            retryCount?: number;
            /**
             * How long should we wait until we try determine connection state again?
             *
             * Default is 50ms
             */
            timeout?: number;
        };

        /**
         * If specified, the connection endpoint will be registered with this value as opposed to extracted from the event payload
         *
         */
        connectionEndpoint?: string;
    };
}

export class Server extends ApolloServer {

    readonly connectionManager: IConnectionManager;
    readonly subscriptionManager: ISubscriptionManager;
    private subscriptionOptions: NonNullable<ServerConfig<Server>["subscriptions"]>;

    constructor({
        connectionManager,
        context,
        subscriptionManager,
        subscriptions,
        ...restConfig
    }: ServerConfig<Server>) {
        super({
            ...restConfig,
            context:
            // if context is function, pass integration context from graphql server options and then merge the result
            // if it's object, merge it with integrationContext
                typeof context === "function"
                    ? (integrationContext: IContext) =>
                        Promise.resolve(context(integrationContext)).then((ctx) => ({
                            ...ctx,
                            ...integrationContext,
                        }))
                    : (integrationContext: IContext) => ({
                        ...context,
                        ...integrationContext,
                    }),
        });

        assert.ok(
            connectionManager,
            "Please provide connectionManager and ensure it implements IConnectionManager",
        );
        assert.ok(
            subscriptionManager,
            "Please provide subscriptionManager and ensure it implements ISubscriptionManager",
        );
        assert.ok(
            subscriptions == null || typeof subscriptions === "object",
            "Property subscriptions must be an object",
        );

        this.connectionManager = connectionManager;
        this.subscriptionManager = subscriptionManager;
        this.subscriptionOptions = subscriptions || {};
    }

    public async execute({
        connection,
        event,
        lambdaContext,
        operation,
        registerSubscriptions = false
    }: Pick<ExecuteOptions, "connection" | "event" | "lambdaContext" | "operation" | "registerSubscriptions">): Promise<ReturnType<typeof execute>> {
        // create PubSub for this subscriber
        const pubSub = new ArrayPubSub([event as any]);

        // following line is really redundant but we need to
        // this makes sure that if you invoke the event
        // and you use Context creator function
        // then it'll be called with $$internal context according to spec
        const $$internal: IContext["$$internal"] = {
            // this provides all other internal params
            // that are assigned in web socket handler

            // this allows createGraphQLServerOptions() to append more extra data
            // to context from connection.data.context
            connection,
            operation,
            pubSub,

            connectionManager: this.connectionManager,
            subscriptionManager: this.subscriptionManager,
        };

        const options = await super
            .graphQLServerOptions({
                event,
                lambdaContext,
                $$internal,
                ...($$internal.connection && $$internal.connection.data
                    ? $$internal.connection.data.context
                    : {}),
            })
            .then((options) => ({ ...options, $$internal }));

        return execute({
            ...options,
            connection,
            connectionManager: this.connectionManager,
            subscriptionManager: this.subscriptionManager,
            onOperation: this.subscriptionOptions.onOperation,
            event,
            lambdaContext,
            operation,
            pubSub,
            registerSubscriptions,
        });
    }

    public createHandler(opts: CreateHandlerOptions = {}): Handler {
        const httpHandler = super.createHandler(opts);
        const dynHandler = new DynamoDBStreamHandler(this);
        const sqsHandler = new SQSEventHandler(this);
        const wsHandler = new WebSocketEventHandler(this, this.subscriptionOptions);

        return (event, context, cb) => {
            // ApiGateway V1 / V2 HTTP request
            if (event.httpMethod) {
                return httpHandler(event, context, cb);
            }

            // ApiGateway V2 WebSocket event
            if (event.requestContext) {
                return wsHandler.handle(event, context);
            }

            // DynamoDB Stream notification
            if (event.Records) {
                if (event.Records[0]?.dynamodb) {
                    return dynHandler.handle(event, context);
                }
                return sqsHandler.handle(event, context);
            }

            // eslint-disable-next-line no-console
            console.error("UNKNOWN EVENT:", event);
            throw new Error("Unknown event");
        }
    }

    public installSubscriptionHandlers(): never {
        throw new Error(
            `Please don't use this method as this server handles subscriptions in it's own way in createWebSocketHandler()`,
        );
    }
}
