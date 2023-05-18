"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SQSEventStore = void 0;
const client_sqs_1 = require("@aws-sdk/client-sqs");
const assert_1 = __importDefault(require("assert"));
/**
 * EventStore implementation that uses an AWS SQS queue.
 */
class SQSEventStore {
    constructor({ sqsClient = new client_sqs_1.SQS({}), queueUrl, }) {
        assert_1.default.ok(typeof queueUrl === "string", "Please provide queueUrl as a string");
        this.sqsClient = sqsClient;
        this.queueUrl = queueUrl;
    }
    publish(event) {
        return this.sqsClient.sendMessage({
            QueueUrl: this.queueUrl,
            MessageBody: JSON.stringify(event),
        });
    }
}
exports.SQSEventStore = SQSEventStore;
