"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DynamoDBSubscriptionManager = void 0;
const assert_1 = __importDefault(require("assert"));
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const helpers_1 = require("./helpers");
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const logger = (0, helpers_1.loggerFromCaller)(__filename);
/**
 * Stores subscription information into the configured DynamoDB table.
 *
 * DynamoDB table structure:
 *  id: primary key (HASH) {connectionId}
 *  opId: range key (RANGE) - {operationId} this is always unique per client
 */
class DynamoDBSubscriptionManager {
    constructor({ dynamoDbClient = new client_dynamodb_1.DynamoDBClient({}), subscriptionsTableName = "Subscriptions", ttl = 7200, getSubscriptionNameFromEvent = (event) => event.event, getSubscriptionNameFromConnection = (name) => name, debug = false, } = {}) {
        assert_1.default.ok(typeof subscriptionsTableName === "string", "Please provide subscriptionsTableName as a string");
        assert_1.default.ok(ttl === false || (typeof ttl === "number" && ttl > 0), "Please provide ttl as a number greater than 0 or false to turn it off");
        assert_1.default.ok(dynamoDbClient == null || typeof dynamoDbClient === "object", "Please provide dynamoDbClient as an instance of DynamoDB.DocumentClient");
        assert_1.default.ok(typeof debug === "boolean", "Please provide debug as a boolean");
        this.subscriptionsTableName = subscriptionsTableName;
        this.db = lib_dynamodb_1.DynamoDBDocumentClient.from(dynamoDbClient);
        this.ttl = ttl;
        this.debug = debug;
        this.getSubscriptionNameFromEvent = getSubscriptionNameFromEvent;
        this.getSubscriptionNameFromConnection = getSubscriptionNameFromConnection;
    }
    async *subscribersByEvent(event) {
        const name = this.getSubscriptionNameFromEvent(event);
        const time = Math.round(Date.now() / 1000);
        assert_1.default.ok(name, "event-name must be non-empty");
        let ExclusiveStartKey;
        do {
            const result = await this.db.send(new lib_dynamodb_1.QueryCommand({
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
            }));
            // the index has all attributes projected, so we don't have to query them
            for (const value of result.Items) {
                yield value;
            }
            ExclusiveStartKey = result.LastEvaluatedKey;
        } while (ExclusiveStartKey != null);
    }
    subscribe(names, connection, operation) {
        const id = connection.id;
        assert_1.default.ok(id, "connection.id must be non-empty");
        assert_1.default.ok(operation.operationId, "operation.operationId must be non-empty");
        if (this.debug) {
            logger.log("Create subscription", names, connection, operation);
        }
        // we can only subscribe to one subscription in GQL document
        if (names.length !== 1) {
            throw new Error("Only one active operation per event name is allowed");
        }
        let [name] = names;
        name = this.getSubscriptionNameFromConnection(name, connection);
        const ttlField = { ttl: (0, helpers_1.computeTTL)(this.ttl) };
        return this.db.send(new lib_dynamodb_1.PutCommand({
            TableName: this.subscriptionsTableName,
            Item: {
                id,
                opId: operation.operationId,
                operationId: operation.operationId,
                connection,
                operation,
                event: name,
                ...ttlField,
            },
        }));
    }
    unsubscribe(subscriber) {
        const id = subscriber.connection.id;
        const opId = subscriber.operationId;
        assert_1.default.ok(id, "subscriber.connection.id must be non-empty");
        assert_1.default.ok(opId, "subscriber.operationId must be non-empty");
        return this.db.send(new lib_dynamodb_1.DeleteCommand({
            TableName: this.subscriptionsTableName,
            Key: { id, opId },
        }));
    }
    async unsubscribeOperation(connectionId, operationId) {
        assert_1.default.ok(connectionId, "connectionId must be non-empty");
        assert_1.default.ok(operationId, "operationId must be non-empty");
        return this.db.send(new lib_dynamodb_1.DeleteCommand({
            TableName: this.subscriptionsTableName,
            Key: {
                id: connectionId,
                opId: operationId,
            }
        }));
    }
    async unsubscribeAllByConnectionId(connectionId) {
        assert_1.default.ok(connectionId, "connectionId must be non-empty");
        let cursor = undefined;
        let found = 0;
        do {
            // @ts-ignore TS dislikes this line for some reason
            const { Items, LastEvaluatedKey } = await this.db.send(new lib_dynamodb_1.QueryCommand({
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
            }));
            if (Items === null || Items === void 0 ? void 0 : Items.length) {
                found += Items.length;
                await this.db.send(new lib_dynamodb_1.BatchWriteCommand({
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
                }));
            }
            cursor = LastEvaluatedKey;
        } while (cursor);
        return found;
    }
}
exports.DynamoDBSubscriptionManager = DynamoDBSubscriptionManager;
