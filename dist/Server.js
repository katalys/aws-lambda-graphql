"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Server = void 0;
/* eslint-disable @typescript-eslint/ban-types */
const apollo_server_lambda_1 = require("apollo-server-lambda");
const assert_1 = __importDefault(require("assert"));
const execute_1 = require("./execute");
const WebSocketEventHandler_1 = require("./WebSocketEventHandler");
const DynamoDBStreamHandler_1 = require("./DynamoDBStreamHandler");
const ArrayPubSub_1 = require("./ArrayPubSub");
const SQSEventHandler_1 = require("./SQSEventHandler");
const helpers_1 = require("./helpers");
class Server extends apollo_server_lambda_1.ApolloServer {
    constructor({ connectionManager, context, subscriptionManager, subscriptions, ...restConfig }) {
        super({
            ...restConfig,
            context: 
            // if context is function, pass integration context from graphql server options and then merge the result
            // if it's object, merge it with integrationContext
            typeof context === "function"
                ? (integrationContext) => Promise.resolve(context(integrationContext)).then((ctx) => ({
                    ...ctx,
                    ...integrationContext,
                }))
                : (integrationContext) => ({
                    ...context,
                    ...integrationContext,
                }),
        });
        assert_1.default.ok(connectionManager, "Please provide connectionManager and ensure it implements IConnectionManager");
        assert_1.default.ok(subscriptionManager, "Please provide subscriptionManager and ensure it implements ISubscriptionManager");
        assert_1.default.ok(subscriptions == null || typeof subscriptions === "object", "Property subscriptions must be an object");
        this.connectionManager = connectionManager;
        this.subscriptionManager = subscriptionManager;
        this.subscriptionOptions = subscriptions || {};
    }
    async execute({ connection, event, lambdaContext, operation, registerSubscriptions = false }) {
        // create PubSub for this subscriber
        const pubSub = new ArrayPubSub_1.ArrayPubSub([event]);
        // following line is really redundant but we need to
        // this makes sure that if you invoke the event
        // and you use Context creator function
        // then it'll be called with $$internal context according to spec
        const $$internal = {
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
        return (0, execute_1.execute)({
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
    createHandler(opts = {}) {
        const httpHandler = super.createHandler(opts);
        const dynHandler = new DynamoDBStreamHandler_1.DynamoDBStreamHandler(this);
        const sqsHandler = new SQSEventHandler_1.SQSEventHandler(this);
        const wsHandler = new WebSocketEventHandler_1.WebSocketEventHandler(this, this.subscriptionOptions);
        const logger = (0, helpers_1.loggerFromCaller)(__filename);
        return (event, context, cb) => {
            const promise = (() => {
                var _a;
                // ApiGateway V1 HTTP request
                if (event.httpMethod) {
                    return httpHandler(event, context, cb);
                }
                // ApiGateway V2
                else if (event.requestContext) {
                    return event.requestContext.connectionId
                        // ApiGateway V2 WebSocket event
                        ? wsHandler.handle(event, context)
                        // ApiGateway V2 HTTP event
                        : httpHandler(event, context, cb);
                }
                // DynamoDB Stream notification
                else if (event.Records) {
                    if ((_a = event.Records[0]) === null || _a === void 0 ? void 0 : _a.dynamodb) {
                        return dynHandler.handle(event);
                    }
                    else {
                        return sqsHandler.handle(event);
                    }
                }
                throw new Error("Unknown event");
            })();
            if (promise) {
                return promise.catch(err => {
                    logger.error("FATAL:", err);
                    logger.log("Original Event:", event);
                    throw err;
                });
            }
            return promise;
        };
    }
    installSubscriptionHandlers() {
        throw new Error(`Please don't use this method as this server handles subscriptions in it's own way in createWebSocketHandler()`);
    }
}
exports.Server = Server;
