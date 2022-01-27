import assert from "assert";
import { ApiGatewayManagementApi, DynamoDB } from "aws-sdk";
import { ConnectionNotFoundError } from "./errors";
import {
    HydrateConnectionOptions,
    IConnectEvent,
    IConnection,
    IConnectionManager,
    ISubscriptionManager,
} from "./types";
import { computeTTL, isTTLExpired, loggerFromCaller } from "./helpers";
import { DynamoDBSubscriptionManager } from "./DynamoDBSubscriptionManager";

const logger = loggerFromCaller(__filename);

interface DynamoDBConnection extends IConnection {
    /**
     * TTL in UNIX seconds
     */
    ttl?: number;
}

interface DynamoDBConnectionManagerOptions {
    /**
     * Use this to override ApiGatewayManagementApi (for example in usage with serverless-offline)
     *
     * If not provided it will be created with endpoint from src
     */
    apiGatewayManager?: ApiGatewayManagementApi;
    /**
     * Connections table name (default is Connections)
     */
    connectionsTable?: string;
    /**
     * Use this to override default document client (for example if you want to use local dynamodb)
     */
    dynamoDbClient?: DynamoDB.DocumentClient;
    subscriptions: ISubscriptionManager;
    /**
     * Optional TTL for src (stored in ttl field) in seconds
     *
     * Default value is 2 hours
     *
     * Set to false to turn off TTL
     */
    ttl?: number | false;

    /**
     * Enable console.log
     */
    debug?: boolean;
}

/**
 * DynamoDBConnectionManager
 *
 * Stores src in DynamoDB table (default table name is Connections, you can override that)
 */
export class DynamoDBConnectionManager implements IConnectionManager {
    private apiGatewayManager: ApiGatewayManagementApi | undefined;

    private connectionsTable: string;

    private db: DynamoDB.DocumentClient;

    private subscriptions: ISubscriptionManager;

    private ttl: number | false;

    private debug: boolean;

    constructor({
        apiGatewayManager,
        connectionsTable = "Connections",
        dynamoDbClient,
        subscriptions,
        ttl = 7200,
        debug = false,
    }: DynamoDBConnectionManagerOptions) {
        assert.ok(
            typeof connectionsTable === "string",
            "Please provide connectionsTable as a string",
        );
        assert.ok(
            typeof subscriptions === "object",
            "Please provide subscriptions to manage subscriptions.",
        );
        assert.ok(
            ttl === false || (typeof ttl === "number" && ttl > 0),
            "Please provide ttl as a number greater than 0 or false to turn it off",
        );
        assert.ok(
            dynamoDbClient == null || typeof dynamoDbClient === "object",
            "Please provide dynamoDbClient as an instance of DynamoDB.DocumentClient",
        );
        assert.ok(
            apiGatewayManager == null || typeof apiGatewayManager === "object",
            "Please provide apiGatewayManager as an instance of ApiGatewayManagementApi",
        );
        assert.ok(typeof debug === "boolean", "Please provide debug as a boolean");

        this.apiGatewayManager = apiGatewayManager;
        this.connectionsTable = connectionsTable;
        this.db = dynamoDbClient || new DynamoDB.DocumentClient();
        this.subscriptions = subscriptions;
        this.ttl = ttl;
        this.debug = debug;
    }

    async hydrateConnection(
        connectionId: string,
        options?: HydrateConnectionOptions,
    ): Promise<DynamoDBConnection> {
        const { retryCount = 0, timeout = 50 } = options || {};
        // if connection is not found, throw so we can terminate connection
        let connection;

        for (let i = 0; i <= retryCount; i++) {
            const result = await this.db
                .get({
                    TableName: this.connectionsTable,
                    Key: {
                        id: connectionId,
                        opId: "",
                    },
                })
                .promise();

            if (result.Item) {
                // Jump out of loop
                connection = result.Item as DynamoDBConnection;
                break;
            }

            // wait for another round
            await new Promise(resolve => setTimeout(resolve, timeout));
        }

        if (!connection || isTTLExpired(connection.ttl)) {
            throw new ConnectionNotFoundError(`Connection ${connectionId} not found`);
        }

        return connection as IConnection;
    }

    async setConnectionData(
        data: IConnection,
        { id }: DynamoDBConnection,
    ): Promise<void> {
        await this.db
            .update({
                TableName: this.connectionsTable,
                Key: {
                    id,
                    opId: ""
                },
                UpdateExpression: "set #data = :data",
                ExpressionAttributeValues: {
                    ":data": data,
                },
                ExpressionAttributeNames: {
                    "#data": "data",
                },
            })
            .promise();
    }

    async registerConnection({
        connectionId,
        endpoint,
    }: IConnectEvent): Promise<DynamoDBConnection> {
        const connection: IConnection = {
            id: connectionId,
            data: { endpoint, context: {}, isInitialized: false },
        };
        if (this.debug) {
            logger.info(`Connection open ${connection.id}`, connection.data);
        }
        await this.db
            .put({
                TableName: this.connectionsTable,
                Item: {
                    id: connection.id,
                    opId: "",
                    data: connection.data,
                    createdAt: new Date().toString(),
                    ttl: computeTTL(this.ttl),
                },
            })
            .promise();

        return connection;
    }

    async sendToConnection(
        connection: DynamoDBConnection,
        payload: string | Buffer,
    ): Promise<void> {
        try {
            if (this.debug) {
                logger.info("sendToConnection", { id: connection.id });
            }
            await this.createApiGatewayManager(connection.data.endpoint)
                .postToConnection({
                    ConnectionId: connection.id,
                    Data: payload
                })
                .promise();
        } catch (e: any) {
            // this is stale connection
            // remove it from DB
            if (e && e.statusCode === 410) {
                await this.unregisterConnection(connection);
            } else {
                throw e;
            }
        }
    }

    async unregisterConnection({ id }: DynamoDBConnection): Promise<void> {
        if ((this.subscriptions as DynamoDBSubscriptionManager).subscriptionsTableName == this.connectionsTable) {
            return this.subscriptions.unsubscribeAllByConnectionId(id);
        }

        await Promise.all([
            this.db
                .delete({
                    TableName: this.connectionsTable,
                    Key: {
                        id,
                        opId: "",
                    },
                })
                .promise(),
            this.subscriptions.unsubscribeAllByConnectionId(id),
        ]);
    }

    async closeConnection({ id, data }: DynamoDBConnection): Promise<void> {
        if (this.debug) {
            logger.info("Connection closed", id);
        }
        await this.createApiGatewayManager(data.endpoint)
            .deleteConnection({ ConnectionId: id })
            .promise();
    }

    /**
     * Creates api gateway manager
     *
     * If custom api gateway manager is provided, uses it instead
     */
    private createApiGatewayManager(endpoint: string): ApiGatewayManagementApi {
        if (this.apiGatewayManager?.endpoint.href == endpoint) {
            return this.apiGatewayManager;
        }

        this.apiGatewayManager = new ApiGatewayManagementApi({ endpoint });

        return this.apiGatewayManager;
    }
}