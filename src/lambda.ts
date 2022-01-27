/* eslint-disable no-console, no-process-env */
import { ApiGatewayManagementApi, DynamoDB } from "aws-sdk";
import { PubSub } from "./PubSub";
import { DynamoDBSubscriptionManager } from "./DynamoDBSubscriptionManager";
import { DynamoDBConnectionManager } from "./DynamoDBConnectionManager";
import { Server } from "./Server";
import { SQSEventStore } from "./SQSEventStore";
import { GraphQLSchema } from "graphql";

export function makeServer(schema: GraphQLSchema): Server {
    const IS_TEST = !!process.env.IS_TEST;
    const dynamoTable = process.env.CONNECTIONS_DYNAMO_TABLE || "";

    const dynamoDbClient = new DynamoDB.DocumentClient({
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
    });

    return new Server({
        schema,
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

function buildMergedSchema(pubSub: PubSub): GraphQLSchema {
    throw new Error("Not implemented");
}

const schema = buildMergedSchema(new PubSub({
    eventStore: new SQSEventStore({
        queueUrl: process.env.CONNECTIONS_SQS_URL || ""
    })
}))

export const lambdaHandler = makeServer(schema).createHandler();

export const handler: typeof lambdaHandler
    = process.env.DEBUG
        ? (event, context, cb) => {
            console.debug("DEBUG Event:", event);
            return lambdaHandler(event, context, cb);
        }
        : lambdaHandler;
