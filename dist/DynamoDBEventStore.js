"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DynamoDBEventStore = void 0;
const assert_1 = __importDefault(require("assert"));
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const ulid_1 = require("ulid");
const helpers_1 = require("./helpers");
/**
 * DynamoDB event store
 *
 * This event store stores published events in DynamoDB table
 *
 * The server uses DynamoDBStreamHandler to process these events.
 */
class DynamoDBEventStore {
    constructor({ dynamoDbClient = new client_dynamodb_1.DynamoDBClient({}), eventsTable = "Events", ttl = 7200, // default: 2 hours
     } = {}) {
        assert_1.default.ok(ttl === false || (typeof ttl === "number" && ttl > 0), "Please provide ttl as a number greater than 0 or false to turn it off");
        assert_1.default.ok(dynamoDbClient instanceof lib_dynamodb_1.DynamoDBDocumentClient, "Please provide dynamoDbClient as an instance of DynamoDB.DocumentClient");
        assert_1.default.ok(typeof eventsTable === "string", "Please provide eventsTable as a string");
        this.db = lib_dynamodb_1.DynamoDBDocumentClient.from(dynamoDbClient);
        this.tableName = eventsTable;
        this.ttl = ttl;
    }
    publish(event) {
        return this.db.send(new lib_dynamodb_1.PutCommand({
            TableName: this.tableName,
            Item: {
                id: (0, ulid_1.ulid)(),
                ttl: (0, helpers_1.computeTTL)(this.ttl),
                ...event,
            },
        }));
    }
}
exports.DynamoDBEventStore = DynamoDBEventStore;
