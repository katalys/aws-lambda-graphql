"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SQSEventHandler = void 0;
const helpers_1 = require("./helpers");
const DynamoDBStreamHandler_1 = require("./DynamoDBStreamHandler");
const logger = (0, helpers_1.loggerFromCaller)(__filename);
class SQSEventHandler extends DynamoDBStreamHandler_1.DynamoDBStreamHandler {
    async handle({ Records }) {
        await Promise.all(Records.map(e => this.handleEvent(e)));
    }
    async handleEvent(record) {
        const event = JSON.parse(record.body);
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
}
exports.SQSEventHandler = SQSEventHandler;
