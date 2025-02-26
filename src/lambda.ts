/* eslint-disable no-console, no-process-env */
import { ApiGatewayManagementApi } from "@aws-sdk/client-apigatewaymanagementapi";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { PubSub } from "./PubSub";
import { DynamoDBSubscriptionManager } from "./DynamoDBSubscriptionManager";
import { DynamoDBConnectionManager } from "./DynamoDBConnectionManager";
import { Server } from "./Server";
import { SQSEventStore } from "./SQSEventStore";
import { buildSchema, GraphQLSchema } from "graphql";

const schema = buildMergedSchema()
const lambdaHandler = makeServer(schema).createHandler();

export const handler: typeof lambdaHandler = (event, context, cb) => {
    console.debug("Received Event:", event);
    return lambdaHandler(event, context, cb);
}

function buildMergedSchema(): GraphQLSchema {
    const pubSub = new PubSub({
        serializeEventPayload: false,
        eventStore: new SQSEventStore({
            queueUrl: process.env.CONNECTIONS_SQS_URL || ""
        })
    });
    console.warn(`Using empty testing schema`);
    return buildSchema(`
        type Query { test: String }
        type Subscription { test: String }
        type Mutation { test: String }
    `);
}

export function makeServer(schema: GraphQLSchema): Server {
    const IS_TEST = !!process.env.IS_TEST;
    let dynamoTable = process.env.CONNECTIONS_DYNAMO_TABLE || "";
    if (dynamoTable.indexOf("/") > 0) {
        dynamoTable = dynamoTable.split("/")[1];
    }

    const dynamoDbClient = new DynamoDBClient({
        // use serverless-dynamodb endpoint in offline mode
        ...(IS_TEST
            ? {
                endpoint: "http://localhost:8000",
            }
            : {}),
    });

    const subscriptionManager = new DynamoDBSubscriptionManager({
        dynamoDbClient,
        subscriptionsTableName: dynamoTable,
        debug: true,
    });

    return new Server({
        schema,
        subscriptions: {
            debug: true,
        },
        subscriptionManager,
        connectionManager: new DynamoDBConnectionManager({
            // this one is weird but we don't care because you'll use it only if you want to use serverless-offline
            // why is it like that? because we are extracting api gateway endpoint from received events
            // but serverless offline has wrong stage and domainName values in event provided to websocket handler
            // so we need to override the endpoint manually
            // please do not use it otherwise because we need correct endpoint, if you use it similarly as dynamoDBClient above
            // you'll end up with errors
            apiGatewayManager: IS_TEST
                ? new ApiGatewayManagementApi({
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
