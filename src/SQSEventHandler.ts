import { SQSEvent, SQSRecord } from "aws-lambda";
import { loggerFromCaller } from "./helpers";
import { DynamoDBStreamHandler } from "./DynamoDBStreamHandler";

const logger = loggerFromCaller(__filename);


export class SQSEventHandler extends DynamoDBStreamHandler {

    async handle({ Records }: SQSEvent): Promise<void> {
        await Promise.all(Records.map(e =>
            this.handleEvent(e))
        );
    }

    async handleEvent(record: SQSRecord): Promise<void> {
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
            promises.push(
                this.processSubscriber(event, subscriber)
                    .catch(err => {
                        logger.error("Subscriber failed:", err);
                    })
            );
        }

        await Promise.all(promises.flat());
    }
}