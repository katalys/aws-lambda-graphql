import { DocumentNode, ExecutionResult } from "graphql";

export const enum CLIENT_EVENT_TYPES {
  GQL_START = "start", // renamed: start => subscribe
  GQL_STOP = "stop", // renamed: stop => complete
  GQL_PING = "ping",
  GQL_PONG = "pong",
  GQL_CONNECTION_INIT = "connection_init",
  GQL_CONNECTION_TERMINATE = "connection_terminate",
}

export const enum SERVER_EVENT_TYPES {
  GQL_CONNECTION_ACK = "connection_ack",
  GQL_ERROR = "error",
  GQL_DATA = "next", // renamed: data => next
  GQL_PING = "ping",
  GQL_PONG = "pong",
  GQL_COMPLETE = "complete",
}

type GQLEventBase<T extends CLIENT_EVENT_TYPES | SERVER_EVENT_TYPES, O> = {
  type: T
} & O
type GQLEventTypes = keyof GQLEvents
export type GQLEvent<K extends GQLEventTypes> = GQLEvents[K]
// export type GQLClientAllEvents = GQLEvent<CLIENT_EVENT_TYPES>
// export type GQLServerAllEvents = GQLEvent<SERVER_EVENT_TYPES>


interface GQLEvents {

  /**
   * Client -> Server
   *
   * Starts an operation (query, mutation, subscription)
   *
   * https://github.com/apollographql/subscriptions-transport-ws/blob/master/src/client.ts#L324
   */
  [CLIENT_EVENT_TYPES.GQL_START]: GQLEventBase<CLIENT_EVENT_TYPES.GQL_START, {
    type: CLIENT_EVENT_TYPES.GQL_START | "subscribe"; // << graphql-ws alternate type
    id: string;
    payload: {
      [key: string]: any;
      extensions?: { [key: string]: any };
      operationName?: string;
      query: string | DocumentNode;
      variables?: { [key: string]: any };
    };
  }>;

  /**
   * Client -> Server
   *
   * Stops subscription
   */
  [CLIENT_EVENT_TYPES.GQL_STOP]: GQLEventBase<CLIENT_EVENT_TYPES.GQL_STOP, {
    /** The ID of GQLOperation used to subscribe */
    id: string;
    // there is no payload
    // https://github.com/apollographql/subscriptions-transport-ws/blob/master/src/client.ts#L665
  }>;

  /**
   * Client -> Server
   */
  [CLIENT_EVENT_TYPES.GQL_CONNECTION_INIT]: GQLEventBase<CLIENT_EVENT_TYPES.GQL_CONNECTION_INIT, {
    // id is not sent
    // see https://github.com/apollographql/subscriptions-transport-ws/blob/master/src/client.ts#L559
    payload?: {
      [key: string]: any;
    };
  }>;

  /**
   * Client -> Server
   */
  [CLIENT_EVENT_TYPES.GQL_CONNECTION_TERMINATE]: GQLEventBase<CLIENT_EVENT_TYPES.GQL_CONNECTION_TERMINATE, {
    // id is not sent
    // see https://github.com/apollographql/subscriptions-transport-ws/blob/master/src/client.ts#L170
    payload?: Record<string, any>;
  }>;

  /**
   * Bidirectional - ping/pong
   */
  [CLIENT_EVENT_TYPES.GQL_PING]: GQLEventBase<SERVER_EVENT_TYPES.GQL_PING, {
    payload?: Record<string, any>;
  }>;
  /**
   * Bidirectional - ping/pong
   */
  [CLIENT_EVENT_TYPES.GQL_PONG]: GQLEventBase<SERVER_EVENT_TYPES.GQL_PONG, {
    payload?: Record<string, any>;
  }>;


  /**
   * Server -> Client
   *
   * Subscription is done
   */
  [SERVER_EVENT_TYPES.GQL_COMPLETE]: GQLEventBase<SERVER_EVENT_TYPES.GQL_COMPLETE, {
    /** The ID of GQLOperation used to subscribe */
    id: string;
  }>;

  /**
   *  Server -> Client as response to GQLConnectionInit
   */
  [SERVER_EVENT_TYPES.GQL_CONNECTION_ACK]: GQLEventBase<SERVER_EVENT_TYPES.GQL_CONNECTION_ACK, {
    id?: string;
    payload?: Record<string, any>;
  }>;

  /**
   * Server -> Client as response to operation or just generic error
   */
  [SERVER_EVENT_TYPES.GQL_ERROR]: GQLEventBase<SERVER_EVENT_TYPES.GQL_ERROR, {
    id?: string;
    payload: {
      message: string;
    };
  }>;

  /**
   * Server -> Client - response to operation
   */
  [SERVER_EVENT_TYPES.GQL_DATA]: GQLEventBase<SERVER_EVENT_TYPES.GQL_DATA, {
    /**
     * Same ID as the ID of an operation that we are returning a result for
     */
    id: string;
    payload: ExecutionResult;
  }>;

}

export function isGQLEvent<T extends GQLEventTypes>(type: T, event: any): event is GQLEvent<T> {
    const found = event && typeof event === "object" && event.type;
    return found === type || (
        type === CLIENT_EVENT_TYPES.GQL_START
        && found === "subscribe" // protocol change
    ) || (
        type === CLIENT_EVENT_TYPES.GQL_STOP
        && found === "complete" // protocol change
    ) || (
        type === SERVER_EVENT_TYPES.GQL_DATA
        && found === "data" // old alias
    );
}

export function formatMessage(event: GQLEvent<any>): string {
    return JSON.stringify(event);
}

export function formatGqlError(message: string): string {
    return formatMessage({
        type: SERVER_EVENT_TYPES.GQL_ERROR,
        payload: { message },
    });
}
