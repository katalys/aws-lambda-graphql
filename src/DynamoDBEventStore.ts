import assert from "assert";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
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
    dynamoDbClient?: DynamoDBClient;
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
    private db: DynamoDBDocumentClient;

    private tableName: string;

    private ttl: number | false;

    constructor({
        dynamoDbClient = new DynamoDBClient({ }),
        eventsTable = "Events",
        ttl = 7200, // default: 2 hours
    }: DynamoDBEventStoreOptions = {}) {
        assert.ok(
            ttl === false || (typeof ttl === "number" && ttl > 0),
            "Please provide ttl as a number greater than 0 or false to turn it off",
        );
        assert.ok(
            dynamoDbClient instanceof DynamoDBDocumentClient,
            "Please provide dynamoDbClient as an instance of DynamoDB.DocumentClient",
        );
        assert.ok(
            typeof eventsTable === "string",
            "Please provide eventsTable as a string",
        );

        this.db = DynamoDBDocumentClient.from(dynamoDbClient);
        this.tableName = eventsTable;
        this.ttl = ttl;
    }

    publish(event: ISubscriptionEvent): Promise<unknown> {
        return this.db.send(new PutCommand({
            TableName: this.tableName,
            Item: {
                id: ulid(),
                ttl: computeTTL(this.ttl),
                ...event,
            },
        }));
    }
}
