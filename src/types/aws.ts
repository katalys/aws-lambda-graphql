import {
    APIGatewayProxyEvent,
    APIGatewayEventRequestContext,
    APIGatewayProxyResult,
    Context as LambdaContext,
} from "aws-lambda";

export type APIGatewayV2Handler = (
  event: APIGatewayWebSocketEvent,
  context: LambdaContext,
) => Promise<APIGatewayProxyResult>;

export interface APIGatewayWebSocketEvent<MessageRouteKey extends "$connect" | "$disconnect" | "$default" = any> extends APIGatewayProxyEvent {
  body: string;

  /**
   * Request context provided by AWS API Gateway V2 proxy event
   *
   * connectionId can be used to identify/terminate the connection to client
   * routeKey can be used to route event by specific parts of communication flow
   */
  requestContext: APIGatewayEventRequestContext & {
    connectionId: string;
    domainName: string;
    routeKey: MessageRouteKey;
  }
}
