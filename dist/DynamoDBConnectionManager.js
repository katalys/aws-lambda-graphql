"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DynamoDBConnectionManager = void 0;
const assert_1 = __importDefault(require("assert"));
const client_apigatewaymanagementapi_1 = require("@aws-sdk/client-apigatewaymanagementapi");
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const errors_1 = require("./errors");
const helpers_1 = require("./helpers");
const logger = (0, helpers_1.loggerFromCaller)(__filename);
/**
 * DynamoDBConnectionManager
 *
 * Stores src in DynamoDB table (default table name is Connections, you can override that)
 */
class DynamoDBConnectionManager {
    constructor({ apiGatewayManager, connectionsTable = "Connections", dynamoDbClient, subscriptions, ttl = 7200, debug = false, }) {
        assert_1.default.ok(typeof connectionsTable === "string", "Please provide connectionsTable as a string");
        assert_1.default.ok(typeof subscriptions === "object", "Please provide subscriptions to manage subscriptions.");
        assert_1.default.ok(ttl === false || (typeof ttl === "number" && ttl > 0), "Please provide ttl as a number greater than 0 or false to turn it off");
        assert_1.default.ok(dynamoDbClient == null || typeof dynamoDbClient === "object", "Please provide dynamoDbClient as an instance of DynamoDB.DocumentClient");
        assert_1.default.ok(apiGatewayManager == null || typeof apiGatewayManager === "object", "Please provide apiGatewayManager as an instance of ApiGatewayManagementApi");
        assert_1.default.ok(typeof debug === "boolean", "Please provide debug as a boolean");
        this.apiGatewayManager = apiGatewayManager;
        this.connectionsTable = connectionsTable;
        this.db = lib_dynamodb_1.DynamoDBDocumentClient.from(dynamoDbClient || new client_dynamodb_1.DynamoDBClient({}));
        this.subscriptions = subscriptions;
        this.ttl = ttl;
        this.debug = debug;
    }
    async hydrateConnection(connectionId, options) {
        const { retryCount = 0, timeout = 50 } = options || {};
        // if connection is not found, throw so we can terminate connection
        let connection;
        for (let i = 0; i <= retryCount; i++) {
            const result = await this.db.send(new lib_dynamodb_1.GetCommand({
                TableName: this.connectionsTable,
                Key: {
                    id: connectionId,
                    opId: "@", // cannot be empty, should be sorted first by UTF-8 code
                },
            }));
            if (result.Item) {
                // Jump out of loop
                connection = result.Item;
                break;
            }
            // wait for another round
            await new Promise(resolve => setTimeout(resolve, timeout));
        }
        if (!connection || (0, helpers_1.isTTLExpired)(connection.ttl)) {
            throw new errors_1.ConnectionNotFoundError(`Connection ${connectionId} not found`);
        }
        return connection;
    }
    async setConnectionData({ id }, data) {
        assert_1.default.ok(id, "connection.id must be provided");
        try {
            await this.db.send(new lib_dynamodb_1.UpdateCommand({
                TableName: this.connectionsTable,
                Key: {
                    id,
                    opId: "@", // cannot be empty, should be sorted first by UTF-8 code
                },
                UpdateExpression: "set #data = :data",
                ExpressionAttributeValues: {
                    ":data": data,
                },
                ExpressionAttributeNames: {
                    "#data": "data",
                },
            }));
        }
        catch (err) {
            logger.error(`setConnectionData(${id}):`, err, data);
            throw err;
        }
    }
    async registerConnection({ connectionId, endpoint, }) {
        assert_1.default.ok(connectionId, "connectionId must be provided");
        const connection = {
            id: connectionId,
            data: { endpoint, context: {}, isInitialized: false },
        };
        if (this.debug) {
            logger.debug(`Connection open ${connection.id}`, connection.data);
        }
        try {
            await this.db.send(new lib_dynamodb_1.PutCommand({
                TableName: this.connectionsTable,
                Item: {
                    id: connection.id,
                    opId: "@",
                    data: connection.data,
                    createdAt: new Date().toString(),
                    ttl: (0, helpers_1.computeTTL)(this.ttl),
                },
            }));
        }
        catch (err) {
            logger.error(`registerConnection():`, err);
            throw err;
        }
        return connection;
    }
    async sendToConnection(connection, payload) {
        assert_1.default.ok(connection.id, "connection.id must be provided");
        try {
            if (this.debug) {
                logger.debug("sendToConnection", { id: connection.id });
            }
            await this.createApiGatewayManager(connection.data.endpoint)
                .postToConnection({
                ConnectionId: connection.id,
                Data: Buffer.from(payload)
            });
        }
        catch (e) {
            // this is stale connection
            // remove it from DB
            if (e && e.statusCode === 410) {
                await this.unregisterConnection(connection);
            }
            else {
                logger.error(`sendToConnection():`, e);
                throw e;
            }
        }
    }
    async unregisterConnection({ id }) {
        assert_1.default.ok(id, "connection.id must be provided");
        if (this.subscriptions.subscriptionsTableName == this.connectionsTable) {
            return this.subscriptions.unsubscribeAllByConnectionId(id);
        }
        await Promise.all([
            this.db.send(new lib_dynamodb_1.DeleteCommand({
                TableName: this.connectionsTable,
                Key: {
                    id,
                    opId: "@", // cannot be empty, should be sorted first by UTF-8 code
                },
            })),
            this.subscriptions.unsubscribeAllByConnectionId(id),
        ]);
    }
    async closeConnection({ id, data }) {
        assert_1.default.ok(id, "connection.id must be provided");
        if (this.debug) {
            logger.debug("Connection closed", id);
        }
        await this.createApiGatewayManager(data.endpoint)
            .deleteConnection({ ConnectionId: id });
    }
    /**
     * Creates api gateway manager
     *
     * If custom api gateway manager is provided, uses it instead
     */
    createApiGatewayManager(endpoint) {
        var _a;
        if (this.apiGatewayManager) {
            const cur = (_a = this.apiGatewayManager) === null || _a === void 0 ? void 0 : _a.config.endpointProvider({});
            if ((cur === null || cur === void 0 ? void 0 : cur.url.href) == endpoint) {
                return this.apiGatewayManager;
            }
        }
        this.apiGatewayManager = new client_apigatewaymanagementapi_1.ApiGatewayManagementApi({ endpoint });
        return this.apiGatewayManager;
    }
}
exports.DynamoDBConnectionManager = DynamoDBConnectionManager;
