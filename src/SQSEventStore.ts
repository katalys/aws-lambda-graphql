import { IEventStore, ISubscriptionEvent } from "./types";
import { SQS } from "@aws-sdk/client-sqs";
import assert from "assert";

interface SQSEventStoreOptions {
    /**
     * Override the default client (for testing, or for better performance with sharing client connection pools)
     */
    sqsClient?: SQS,
    /**
     * URL to the SQS Queue.
     */
    queueUrl: string;
}

/**
 * EventStore implementation that uses an AWS SQS queue.
 */
export class SQSEventStore implements IEventStore {
    private queueUrl: string;
    private sqsClient: SQS;

    constructor({
        sqsClient = new SQS({ }),
        queueUrl,
    }: SQSEventStoreOptions) {
        assert.ok(
            typeof queueUrl === "string",
            "Please provide queueUrl as a string",
        );

        this.sqsClient = sqsClient;
        this.queueUrl = queueUrl;
    }

    publish(event: ISubscriptionEvent): Promise<unknown> {
        return this.sqsClient.sendMessage({
            QueueUrl: this.queueUrl,
            MessageBody: JSON.stringify(event),
        });
    }
}
