import assert from "assert";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BatchWriteCommand, DynamoDBDocumentClient, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import {
    IConnection,
    ISubscriber,
    ISubscriptionManager,
    IdentifiedOperationRequest,
    ISubscriptionEvent,
} from "./types";
import { computeTTL } from "./helpers";

const DEFAULT_TTL = 7200;

interface DynamoDBSubscriber extends ISubscriber {
  /**
   * works as range key in DynamoDb (event is partition key)
   * it is in format connectionId:operationId
   */
  subscriptionId: string;
  /**
   * TTL in UNIX seconds
   */
  ttl?: number;
}

interface DynamoDBSubscriptionManagerOptions {
  /**
   * Use this to override default document client (for example if you want to use local dynamodb)
   */
  dynamoDbClient?: DynamoDBClient;
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
}

/**
 * DynamoDBSubscriptionManager
 *
 * Stores all subsrciptions in Subscriptions and SubscriptionOperations tables (both can be overridden)
 *
 * DynamoDB table structures
 *
 * Subscriptions:
 *  event: primary key (HASH)
 *  subscriptionId: range key (RANGE) - connectionId:operationId (this is always unique per client)
 *
 * SubscriptionOperations:
 *  subscriptionId: primary key (HASH) - connectionId:operationId (this is always unique per client)
 *  event: range key (RANGE)

 */

/** In order to use this implementation you need to use RANGE key for event in serverless.yml */
export class DynamoDBRangeSubscriptionManager implements ISubscriptionManager {
  private subscriptionsTableName: string;

  private subscriptionOperationsTableName: string;

  private db: DynamoDBDocumentClient;

  private readonly ttl: number | false;

  private readonly getSubscriptionNameFromEvent: (event: ISubscriptionEvent) => string;

  constructor({
      dynamoDbClient,
      subscriptionsTableName = "Subscriptions",
      subscriptionOperationsTableName = "SubscriptionOperations",
      ttl = DEFAULT_TTL,
      getSubscriptionNameFromEvent = (event) => event.event,
  }: DynamoDBSubscriptionManagerOptions = {}) {
      assert.ok(
          typeof subscriptionOperationsTableName === "string",
          "Please provide subscriptionOperationsTableName as a string",
      );
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

      this.subscriptionsTableName = subscriptionsTableName;
      this.subscriptionOperationsTableName = subscriptionOperationsTableName;
      this.db = DynamoDBDocumentClient.from(dynamoDbClient || new DynamoDBClient({}));
      this.ttl = ttl;
      this.getSubscriptionNameFromEvent = getSubscriptionNameFromEvent;
  }

  async *subscribersByEvent(
      event: ISubscriptionEvent,
  ): AsyncGenerator<ISubscriber> {
      const name = this.getSubscriptionNameFromEvent(event);
      const time = Math.round(Date.now() / 1000);
      assert.ok(name, "event-name must be non-empty");

      let ExclusiveStartKey: any | undefined
      do {
          const result = await this.db.send(new QueryCommand({
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
          for (const value of result.Items as DynamoDBSubscriber[]) {
              yield value;
          }

          ExclusiveStartKey = result.LastEvaluatedKey;
      } while (ExclusiveStartKey != null);
  }

  subscribe = async (
      names: string[],
      connection: IConnection,
      operation: IdentifiedOperationRequest,
  ): Promise<void> => {
      const subscriptionId = this.generateSubscriptionId(
          connection.id,
          operation.operationId,
      );

      const ttlField =
      this.ttl === false || this.ttl == null
          ? {}
          : { ttl: computeTTL(this.ttl) };

      await this.db.send(new BatchWriteCommand({
          RequestItems: {
              [this.subscriptionsTableName]: names.map((name) => ({
                  PutRequest: {
                      Item: {
                          connection,
                          operation,
                          event: name,
                          subscriptionId,
                          operationId: operation.operationId,
                          ...ttlField,
                      } as DynamoDBSubscriber,
                  },
              })),
              [this.subscriptionOperationsTableName]: names.map((name) => ({
                  PutRequest: {
                      Item: {
                          subscriptionId,
                          event: name,
                          ...ttlField,
                      },
                  },
              })),
          },
      }));
  };

  unsubscribe = async (subscriber: ISubscriber) => {
      const subscriptionId = this.generateSubscriptionId(
          subscriber.connection.id,
          subscriber.operationId,
      );

      await this.db.send(new TransactWriteCommand({
          TransactItems: [
              {
                  Delete: {
                      TableName: this.subscriptionsTableName,
                      Key: {
                          event: subscriber.event,
                          subscriptionId,
                      },
                  },
              },
              {
                  Delete: {
                      TableName: this.subscriptionOperationsTableName,
                      Key: {
                          subscriptionId,
                          event: subscriber.event,
                      },
                  },
              },
          ],
      }));
  };

  unsubscribeOperation = async (connectionId: string, operationId: string) => {
      const operation = await this.db.send(new QueryCommand({
          TableName: this.subscriptionOperationsTableName,
          KeyConditionExpression: "subscriptionId = :id",
          ExpressionAttributeValues: {
              ":id": this.generateSubscriptionId(connectionId, operationId),
          },
      }));

      if (operation.Items) {
          await this.db.send(new BatchWriteCommand({
              RequestItems: {
                  [this.subscriptionsTableName]: operation.Items.map((item) => ({
                      DeleteRequest: {
                          Key: { event: item.event, subscriptionId: item.subscriptionId },
                      },
                  })),
                  [this.subscriptionOperationsTableName]: operation.Items.map(
                      (item) => ({
                          DeleteRequest: {
                              Key: {
                                  subscriptionId: item.subscriptionId,
                                  event: item.event,
                              },
                          },
                      }),
                  ),
              },
          }));
      }
  };

  unsubscribeAllByConnectionId = async (connectionId: string) => {
      let cursor: any | undefined;

      do {
          const { Items, LastEvaluatedKey } = await this.db.send(new QueryCommand({
              TableName: this.subscriptionsTableName,
              ExclusiveStartKey: cursor,
              KeyConditionExpression: "type=:type AND begins_with(subscriptionId, :connection_id)",
              ExpressionAttributeValues: {
                  ":type": "connection",
                  ":connection_id": connectionId,
              },
              ProjectionExpression: "event, subscriptionId",
              Limit: 12, // Maximum of 25 request items sent to DynamoDB a time
          }));

          if (Items == null || !Items.length) {
              return;
          }

          await this.db.send(new BatchWriteCommand({
              RequestItems: {
                  [this.subscriptionsTableName]: Items.map((item) => ({
                      DeleteRequest: {
                          Key: { event: item.event, subscriptionId: item.subscriptionId },
                      },
                  })),
                  [this.subscriptionOperationsTableName]: Items.map((item) => ({
                      DeleteRequest: {
                          Key: { subscriptionId: item.subscriptionId, event: item.event },
                      },
                  })),
              },
          }));

          cursor = LastEvaluatedKey;
      } while (cursor);
  };

  generateSubscriptionId = (
      connectionId: string,
      operationId: string,
  ): string => {
      return `${connectionId}:${operationId}`;
  };
}
