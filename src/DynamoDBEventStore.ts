import assert from "assert";
import { DynamoDB } from "aws-sdk";
import { ulid } from "ulid";
import { IEventStore, ISubscriptionEvent } from "./types";
import { computeTTL } from "./helpers";

export interface IDynamoDBSubscriptionEvent extends ISubscriptionEvent {
    /**
     * TTL in UNIX seconds
     */
    ttl?: number;
}

interface DynamoDBEventStoreOptions {
    /**
     * Use this to override default document client (for example if you want to use local dynamodb)
     */
    dynamoDbClient?: DynamoDB.DocumentClient;
    /**
     * Events table name (default is Events)
     */
    eventsTable?: string;
    /**
     * TTL for events (stored in ttl field) in seconds
     * If you do not define a TTL, then you must delete events later or the table will
     * grow forever.
     *
     * Default: 2 hours; define as false to disable
     */
    ttl?: number | false;
}

/**
 * DynamoDB event store
 *
 * This event store stores published events in DynamoDB table
 *
 * The server uses DynamoDBStreamHandler to process these events.
 */
export class DynamoDBEventStore implements IEventStore {
    private db: DynamoDB.DocumentClient;

    private tableName: string;

    private ttl: number | false;

    constructor({
        dynamoDbClient = new DynamoDB.DocumentClient(),
        eventsTable = "Events",
        ttl = 7200, // default: 2 hours
    }: DynamoDBEventStoreOptions = {}) {
        assert.ok(
            ttl === false || (typeof ttl === "number" && ttl > 0),
            "Please provide ttl as a number greater than 0 or false to turn it off",
        );
        assert.ok(
            dynamoDbClient instanceof DynamoDB.DocumentClient,
            "Please provide dynamoDbClient as an instance of DynamoDB.DocumentClient",
        );
        assert.ok(
            typeof eventsTable === "string",
            "Please provide eventsTable as a string",
        );

        this.db = dynamoDbClient;
        this.tableName = eventsTable;
        this.ttl = ttl;
    }

    publish(event: ISubscriptionEvent): Promise<unknown> {
        return this.db
            .put({
                TableName: this.tableName,
                Item: {
                    id: ulid(),
                    ttl: computeTTL(this.ttl),
                    ...event,
                },
            })
            .promise();
    }
}
