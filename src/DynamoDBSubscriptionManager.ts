import assert from "assert";
import { DynamoDB } from "aws-sdk";
import {
    IConnection,
    ISubscriber,
    ISubscriptionManager,
    IdentifiedOperationRequest,
    ISubscriptionEvent,
} from "./types";
import { computeTTL, loggerFromCaller } from "./helpers";

interface DynamoDBSubscriber extends ISubscriber {
    /**
     * Connection ID
     */
    id: string;
    /**
     * TTL in UNIX seconds
     */
    ttl?: number;
}

interface DynamoDBSubscriptionManagerOptions {
    /**
     * Use this to override default document client (for example if you want to use local dynamodb)
     */
    dynamoDbClient?: DynamoDB.DocumentClient;
    /**
     * Subscriptions table name (default is Subscriptions)
     */
    subscriptionsTableName?: string;
    /**
     * Subscriptions operations table name (default is SubscriptionOperations)
     */
    subscriptionOperationsTableName?: string;
    /**
     * Optional TTL for subscriptions (stored in ttl field) in seconds
     *
     * Default value is 2 hours
     *
     * Set to false to turn off TTL
     */
    ttl?: number | false;
    /**
     * Optional function that can get subscription name from event
     *
     * Default is (event: ISubscriptionEvent) => event.event
     *
     * Useful for multi-tenancy
     */
    getSubscriptionNameFromEvent?: (event: ISubscriptionEvent) => string;
    /**
     * Optional function that can get subscription name from subscription connection
     *
     * Default is (name: string, connection: IConnection) => name
     *
     * Useful for multi-tenancy
     */
    getSubscriptionNameFromConnection?: (
        name: string,
        connection: IConnection,
    ) => string;
    /**
     * Enable console.log
     */
    debug?: boolean;
}

const logger = loggerFromCaller(__filename);

/**
 * Stores subscription information into the configured DynamoDB table.
 *
 * DynamoDB table structure:
 *  id: primary key (HASH) {connectionId}
 *  opId: range key (RANGE) - {operationId} this is always unique per client
 */
export class DynamoDBSubscriptionManager implements ISubscriptionManager {
    subscriptionsTableName: string;

    private db: DynamoDB.DocumentClient;

    private ttl: number | false;

    private debug: boolean;

    private getSubscriptionNameFromEvent: (event: ISubscriptionEvent) => string;

    private getSubscriptionNameFromConnection: (
        name: string,
        connection: IConnection,
    ) => string;

    constructor({
        dynamoDbClient = new DynamoDB.DocumentClient(),
        subscriptionsTableName = "Subscriptions",
        ttl = 7200,
        getSubscriptionNameFromEvent = (event) => event.event,
        getSubscriptionNameFromConnection = (name) => name,
        debug = false,
    }: DynamoDBSubscriptionManagerOptions = {}) {
        assert.ok(
            typeof subscriptionsTableName === "string",
            "Please provide subscriptionsTableName as a string",
        );
        assert.ok(
            ttl === false || (typeof ttl === "number" && ttl > 0),
            "Please provide ttl as a number greater than 0 or false to turn it off",
        );
        assert.ok(
            dynamoDbClient == null || typeof dynamoDbClient === "object",
            "Please provide dynamoDbClient as an instance of DynamoDB.DocumentClient",
        );
        assert.ok(typeof debug === "boolean", "Please provide debug as a boolean");

        this.subscriptionsTableName = subscriptionsTableName;
        this.db = dynamoDbClient;
        this.ttl = ttl;
        this.debug = debug;
        this.getSubscriptionNameFromEvent = getSubscriptionNameFromEvent;
        this.getSubscriptionNameFromConnection = getSubscriptionNameFromConnection;
    }

    subscribersByEvent(
        event: ISubscriptionEvent,
    ): AsyncIterable<ISubscriber[]> & AsyncIterator<ISubscriber[]> {
        let ExclusiveStartKey: DynamoDB.DocumentClient.Key | undefined;
        let done = false;

        const name = this.getSubscriptionNameFromEvent(event);
        const time = Math.round(Date.now() / 1000);
        assert.ok(name, "event-name must be non-empty");

        return {
            next: async () => {
                if (done) {
                    return { value: [], done: true };
                }

                const result = await this.db
                    .query({
                        ExclusiveStartKey,
                        TableName: this.subscriptionsTableName,
                        Limit: 50,
                        IndexName: "EventNames",
                        KeyConditionExpression: "event = :event",
                        FilterExpression: "#ttl > :time OR attribute_not_exists(#ttl)",
                        ExpressionAttributeValues: {
                            ":event": name,
                            ":time": time,
                        },
                        ExpressionAttributeNames: {
                            "#ttl": "ttl",
                        },
                    })
                    .promise();

                ExclusiveStartKey = result.LastEvaluatedKey;

                if (ExclusiveStartKey == null) {
                    done = true;
                }

                // we store connectionData on subscription too so we don't
                // need to load data from src table
                const value = result.Items as DynamoDBSubscriber[];

                return { value, done: done && value.length === 0 };
            },
            [Symbol.asyncIterator]() {
                return this;
            },
        };
    }

    subscribe(
        names: string[],
        connection: IConnection,
        operation: IdentifiedOperationRequest,
    ): Promise<unknown> {
        const id = connection.id;
        assert.ok(id, "connection.id must be non-empty");
        assert.ok(operation.operationId, "operation.operationId must be non-empty");

        if (this.debug) {
            logger.log("Create subscription", names, connection, operation);
        }

        // we can only subscribe to one subscription in GQL document
        if (names.length !== 1) {
            throw new Error("Only one active operation per event name is allowed");
        }
        let [name] = names;
        name = this.getSubscriptionNameFromConnection(name, connection);

        const ttlField = { ttl: computeTTL(this.ttl) };

        return this.db.put({
            TableName: this.subscriptionsTableName,
            Item: {
                id,
                opId: operation.operationId, // for the key lookup
                operationId: operation.operationId, // for NodeJS code to reference
                connection,
                operation,
                event: name,
                ...ttlField,
            } as DynamoDBSubscriber,
        })
            .promise();
    }

    unsubscribe(subscriber: ISubscriber): Promise<unknown> {
        const id = subscriber.connection.id;
        const opId = subscriber.operationId;
        assert.ok(id, "subscriber.connection.id must be non-empty");
        assert.ok(opId, "subscriber.operationId must be non-empty");

        return this.db.delete({
            TableName: this.subscriptionsTableName,
            Key: { id, opId },
        })
            .promise();
    }

    async unsubscribeOperation(connectionId: string, operationId: string): Promise<unknown> {
        assert.ok(connectionId, "connectionId must be non-empty");
        assert.ok(operationId, "operationId must be non-empty");
        return this.db.delete({
            TableName: this.subscriptionsTableName,
            Key: {
                id: connectionId,
                opId: operationId,
            }
        })
            .promise();
    }

    async unsubscribeAllByConnectionId(connectionId: string): Promise<number> {
        assert.ok(connectionId, "connectionId must be non-empty");
        let cursor: DynamoDB.DocumentClient.Key | undefined = undefined;
        let found = 0;

        do {
            // @ts-ignore TS dislikes this line for some reason
            const { Items, LastEvaluatedKey } = await this.db
                .query({
                    TableName: this.subscriptionsTableName,
                    ExclusiveStartKey: cursor,
                    KeyConditionExpression: "#id = :connection_id",
                    ExpressionAttributeNames: {
                        "#id": "id",
                    },
                    ExpressionAttributeValues: {
                        ":connection_id": connectionId,
                    },
                    Limit: 25, // Maximum of 25 request items sent to DynamoDB a time
                })
                .promise();

            if (Items?.length) {
                found += Items.length;
                await this.db
                    .batchWrite({
                        RequestItems: {
                            [this.subscriptionsTableName]: Items.map((item) => ({
                                DeleteRequest: {
                                    Key: {
                                        id: item.id,
                                        opId: item.opId,
                                    },
                                },
                            })),
                        },
                    })
                    .promise();
            }

            cursor = LastEvaluatedKey;
        } while (cursor);

        return found;
    }
}
