import { APIGatewayEvent, Context as LambdaContext } from "aws-lambda";
import {
    ASTVisitor,
    DocumentNode,
    execute as gqlExecute,
    ExecutionArgs,
    getOperationAST,
    GraphQLSchema,
    parse,
    specifiedRules,
    subscribe as gqlSubscribe,
    SubscriptionArgs,
    validate,
    ValidationContext,
} from "graphql";
import { PubSubEngine } from "graphql-subscriptions";
import {
    APIGatewayWebSocketEvent,
    IConnection,
    IConnectionManager,
    IContext,
    ISubscriptionManager,
    OperationRequest,
} from "./types";

export interface ExecutionParams {
    query: DocumentNode;
    variables?: { [key: string]: any } | null | undefined;
    operationName?: string | null | undefined;
    context: any;
    schema?: GraphQLSchema;
}

export interface ExecuteOptions {
    connection: IConnection;
    connectionManager: IConnectionManager;
    context?: any;
    event: APIGatewayEvent | APIGatewayWebSocketEvent;
    fieldResolver?: ExecutionArgs["fieldResolver"];
    lambdaContext?: LambdaContext;
    /**
     * Optional function to modify execute options for specific operations
     */
    onOperation?: (
        message: OperationRequest,
        params: ExecutionParams,
        connection: IConnection,
    ) => Promise<ExecutionParams> | ExecutionParams;
    operation: OperationRequest;
    pubSub: PubSubEngine;
    /**
     * This is internal param used to indicate if we should register subscriptions to storage
     * Basically this is used by WebSocket handler to manage subscriptions
     * But in case of event processor this is must be false always, because we don't want to register
     * new subscriptions in event processor
     *
     * default is false
     */
    registerSubscriptions?: boolean;
    rootValue?: ExecutionArgs["rootValue"];
    schema: GraphQLSchema;
    subscribeFieldResolver?: SubscriptionArgs["subscribeFieldResolver"];
    subscriptionManager: ISubscriptionManager;
    typeResolver?: ExecutionArgs["typeResolver"];
    /**
     * An optional array of validation rules that will be applied on the document
     * in additional to those defined by the GraphQL spec.
     */
    validationRules?: ((context: ValidationContext) => ASTVisitor)[];
}

/**
 * Executes graphql operation
 *
 * In case of mutation/query it returns ExecutionResult
 * In case of subscriptions it returns AsyncIterator of ExecutionResults (only if useSubscriptions is true)
 */
export async function execute({
    connection,
    connectionManager,
    context,
    event,
    fieldResolver,
    lambdaContext = {} as any,
    onOperation,
    operation,
    pubSub,
    rootValue,
    schema,
    subscriptionManager,
    registerSubscriptions = false,
    typeResolver,
    validationRules = [],
}: ExecuteOptions): Promise<ReturnType<(typeof gqlSubscribe | typeof gqlExecute)>> {

    // extract query from operation (parse if is string);
    const document = typeof operation.query !== "string"
        ? operation.query
        : parse(operation.query);

    // validate document
    {
        const validationErrors = validate(schema, document, [
            ...specifiedRules,
            ...validationRules,
        ]);

        if (validationErrors.length > 0) {
            return {
                errors: validationErrors,
            };
        }
    }

    // detect operation type
    const operationAST = getOperationAST(document, operation.operationName);
    if (!operationAST) {
        throw new Error(`Invalid schema document for operationName:${operation.operationName}`);
    }

    // this is internal context that should not be used by a user in resolvers
    // this is only added to provide access for PubSub to get connection managers and other
    // internal stuff
    const internalContext: IContext = {
        event,
        lambdaContext,
        $$internal: {
            connection,
            connectionManager,
            operation,
            pubSub,
            registerSubscriptions,
            subscriptionManager,
        },
    };

    // context stored in connection state
    const connectionContext = connection.data ? connection.data.context : {};

    // instantiate context
    const contextValue =
        typeof context === "function"
            ? await context({
                ...internalContext,
                ...connectionContext,
            })
            : context;

    let params: ExecutionParams = {
        context: {
            ...connectionContext,
            ...contextValue,
            ...internalContext,
        },
        operationName: operation.operationName,
        query: document,
        schema,
        variables: operation.variables,
    };

    if (onOperation) {
        params = await onOperation(operation, params, connection);
        if (!params || typeof params !== "object") {
            throw new Error("`onOperation()` must return an object.");
        }
        if (!params.schema) {
            throw new Error("Missing schema parameter!");
        }
    }

    const processedContext = {
        ...params.context,
        ...internalContext,
        $$internal: {
            ...params.context.$$internal,
            ...internalContext.$$internal,
        },
    };

    return operationAST.operation === "subscription"
        ? gqlSubscribe({
            contextValue: processedContext,
            document,
            fieldResolver,
            operationName: params.operationName,
            rootValue,
            schema: params.schema || schema,
            variableValues: params.variables,
        })
        : gqlExecute({
            contextValue: processedContext,
            document,
            fieldResolver,
            operationName: params.operationName,
            rootValue,
            schema: params.schema || schema,
            typeResolver,
            variableValues: params.variables,
        });
}
