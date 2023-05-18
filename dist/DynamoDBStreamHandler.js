"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DynamoDBStreamHandler = void 0;
const util_dynamodb_1 = require("@aws-sdk/util-dynamodb");
const protocol_1 = require("./protocol");
const helpers_1 = require("./helpers");
const logger = (0, helpers_1.loggerFromCaller)(__filename);
/**
 * Processes DynamoDB stream event in order to send events to subscribed clients
 */
class DynamoDBStreamHandler {
    constructor(server, options = {}) {
        this.server = server;
        this.options = options;
        this.debug = Boolean(options.debug);
    }
    async handle({ Records }) {
        await Promise.all(Records.map(e => this.handleEvent(e)));
    }
    async handleEvent(record) {
        // process only INSERT events
        if (record.eventName !== "INSERT" || !record.dynamodb) {
            logger.info(`Skipping eventName=${record.eventName}`);
            return;
        }
        // now construct event from dynamodb image
        const event = (0, util_dynamodb_1.unmarshall)(record.dynamodb.NewImage);
        // skip if event is expired
        if ((0, helpers_1.isTTLExpired)(event.ttl)) {
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
            promises.push(this.processSubscriber(event, subscriber)
                .catch(err => {
                logger.error("Subscriber failed:", subscriber, err);
            }));
        }
        await Promise.all(promises.flat());
    }
    async processSubscriber(event, subscriber) {
        // execute operation then publish the event
        const iterable = await this.server.execute({
            event: event,
            // lambdaContext,
            connection: subscriber.connection,
            operation: subscriber.operation,
            registerSubscriptions: false,
        });
        if (!(0, helpers_1.isAsyncIterable)(iterable)) {
            // something went wrong, probably there is an error
            logger.warn(`Unknown GQL response`);
            return;
        }
        const iterator = iterable[Symbol.asyncIterator]();
        const result = await iterator.next();
        if (this.debug) {
            logger.log("Send event", result);
        }
        if (result.value != null) {
            return this.server.connectionManager.sendToConnection(subscriber.connection, (0, protocol_1.formatMessage)({
                id: subscriber.operationId,
                payload: result.value,
                type: "next" /* SERVER_EVENT_TYPES.GQL_DATA */,
            }));
        }
    }
}
exports.DynamoDBStreamHandler = DynamoDBStreamHandler;
