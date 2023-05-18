"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeServer = exports.handler = void 0;
/* eslint-disable no-console, no-process-env */
const client_apigatewaymanagementapi_1 = require("@aws-sdk/client-apigatewaymanagementapi");
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const PubSub_1 = require("./PubSub");
const DynamoDBSubscriptionManager_1 = require("./DynamoDBSubscriptionManager");
const DynamoDBConnectionManager_1 = require("./DynamoDBConnectionManager");
const Server_1 = require("./Server");
const SQSEventStore_1 = require("./SQSEventStore");
const graphql_1 = require("graphql");
const schema = buildMergedSchema();
const lambdaHandler = makeServer(schema).createHandler();
const handler = (event, context, cb) => {
    console.debug("Received Event:", event);
    return lambdaHandler(event, context, cb);
};
exports.handler = handler;
function buildMergedSchema() {
    const pubSub = new PubSub_1.PubSub({
        serializeEventPayload: false,
        eventStore: new SQSEventStore_1.SQSEventStore({
            queueUrl: process.env.CONNECTIONS_SQS_URL || ""
        })
    });
    console.warn(`Using empty testing schema`);
    return (0, graphql_1.buildSchema)(`
        type Query { test: String }
        type Subscription { test: String }
        type Mutation { test: String }
    `);
}
function makeServer(schema) {
    const IS_TEST = !!process.env.IS_TEST;
    let dynamoTable = process.env.CONNECTIONS_DYNAMO_TABLE || "";
    if (dynamoTable.indexOf("/") > 0) {
        dynamoTable = dynamoTable.split("/")[1];
    }
    const dynamoDbClient = new client_dynamodb_1.DynamoDBClient({
        // use serverless-dynamodb endpoint in offline mode
        ...(IS_TEST
            ? {
                endpoint: "http://localhost:8000",
            }
            : {}),
    });
    const subscriptionManager = new DynamoDBSubscriptionManager_1.DynamoDBSubscriptionManager({
        dynamoDbClient,
        subscriptionsTableName: dynamoTable,
        debug: true,
    });
    return new Server_1.Server({
        schema,
        subscriptions: {
            debug: true,
        },
        subscriptionManager,
        connectionManager: new DynamoDBConnectionManager_1.DynamoDBConnectionManager({
            // this one is weird but we don't care because you'll use it only if you want to use serverless-offline
            // why is it like that? because we are extracting api gateway endpoint from received events
            // but serverless offline has wrong stage and domainName values in event provided to websocket handler
            // so we need to override the endpoint manually
            // please do not use it otherwise because we need correct endpoint, if you use it similarly as dynamoDBClient above
            // you'll end up with errors
            apiGatewayManager: IS_TEST
                ? new client_apigatewaymanagementapi_1.ApiGatewayManagementApi({
                    endpoint: "http://localhost:3001",
                })
                : undefined,
            dynamoDbClient,
            connectionsTable: dynamoTable,
            subscriptions: subscriptionManager,
            debug: true,
        }),
        // use serverless-offline endpoint in offline mode
        ...(IS_TEST
            ? {
                playground: {
                    subscriptionEndpoint: "ws://localhost:3001",
                },
            }
            : {}),
    });
}
exports.makeServer = makeServer;
