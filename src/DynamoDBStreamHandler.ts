import { DynamoDBRecord, DynamoDBStreamEvent } from "aws-lambda";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { ExecutionResult } from "graphql";
import { formatMessage, SERVER_EVENT_TYPES } from "./protocol";
import { Server } from "./Server";
import { IDynamoDBSubscriptionEvent } from "./DynamoDBEventStore";
import { isAsyncIterable, isTTLExpired, loggerFromCaller } from "./helpers";
import { ISubscriber, ISubscriptionEvent } from "./types";

const logger = loggerFromCaller(__filename);

/**
 * Processes DynamoDB stream event in order to send events to subscribed clients
 */
export class DynamoDBStreamHandler {
    private debug: boolean;

    constructor(
        protected server: Server,
        private options: {
            onError?: (err: any) => void;
            /**
             * Enable console.log
             */
            debug?: boolean;
        } = {}
    ) {
        this.debug = Boolean(options.debug);
    }

    async handle({ Records }: DynamoDBStreamEvent): Promise<void> {
        await Promise.all(Records.map(e =>
            this.handleEvent(e))
        );
    }

    async handleEvent(record: DynamoDBRecord): Promise<void> {
        // process only INSERT events
        if (record.eventName !== "INSERT" || !record.dynamodb) {
            logger.info(`Skipping eventName=${record.eventName}`);
            return;
        }

        // now construct event from dynamodb image
        const event = unmarshall(
            record.dynamodb.NewImage as any,
        ) as IDynamoDBSubscriptionEvent;

        // skip if event is expired
        if (isTTLExpired(event.ttl)) {
            if (this.debug) {
                logger.log("Discarded event : TTL expired", event);
            }
            return;
        }

        // iterate over subscribers that listen to this event
        // and for each connection:
        //  - create a schema (so we have subscribers registered in PubSub)
        //  - execute operation from event against schema
        //  - if iterator returns a result, send it to client
        //  - clean up subscriptions and follow with next page of subscriptions
        //  - if they are no more subscriptions, process next event
        // make sure that you won't throw any errors otherwise dynamo will call
        // handler with same events again
        const promises = [];
        for await (const subscriber of this.server.subscriptionManager.subscribersByEvent(event)) {
            promises.push(
                this.processSubscriber(event, subscriber)
                    .catch(err => {
                        logger.error("Subscriber failed:", subscriber, err);
                    })
            );
        }

        await Promise.all(promises.flat());
    }

    async processSubscriber(event: ISubscriptionEvent, subscriber: ISubscriber): Promise<void> {
        // execute operation then publish the event
        const iterable = await this.server.execute({
            event: event as any, // we don't have an API GW event here
            // lambdaContext,
            connection: subscriber.connection,
            operation: subscriber.operation,
            registerSubscriptions: false,
        });

        if (!isAsyncIterable(iterable)) {
            // something went wrong, probably there is an error
            logger.warn(`Unknown GQL response`);
            return;
        }

        const iterator = (iterable as AsyncIterableIterator<ExecutionResult>)[Symbol.asyncIterator]();
        const result = await iterator.next();

        if (this.debug) {
            logger.log("Send event", result);
        }

        if (result.value != null) {
            return this.server.connectionManager.sendToConnection(
                subscriber.connection,
                formatMessage({
                    id: subscriber.operationId,
                    payload: result.value,
                    type: SERVER_EVENT_TYPES.GQL_DATA,
                }),
            );
        }
    }
}
