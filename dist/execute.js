"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.execute = void 0;
const graphql_1 = require("graphql");
/**
 * Executes graphql operation
 *
 * In case of mutation/query it returns ExecutionResult
 * In case of subscriptions it returns AsyncIterator of ExecutionResults (only if useSubscriptions is true)
 */
async function execute({ connection, connectionManager, context, event, fieldResolver, lambdaContext = {}, onOperation, operation, pubSub, rootValue, schema, subscriptionManager, registerSubscriptions = false, typeResolver, validationRules = [], }) {
    // extract query from operation (parse if is string);
    const document = typeof operation.query !== "string"
        ? operation.query
        : (0, graphql_1.parse)(operation.query);
    // validate document
    {
        const validationErrors = (0, graphql_1.validate)(schema, document, [
            ...graphql_1.specifiedRules,
            ...validationRules,
        ]);
        if (validationErrors.length > 0) {
            return {
                errors: validationErrors,
            };
        }
    }
    // detect operation type
    const operationAST = (0, graphql_1.getOperationAST)(document, operation.operationName);
    if (!operationAST) {
        throw new Error(`Invalid schema document for operationName:${operation.operationName}`);
    }
    // this is internal context that should not be used by a user in resolvers
    // this is only added to provide access for PubSub to get connection managers and other
    // internal stuff
    const internalContext = {
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
    const contextValue = typeof context === "function"
        ? await context({
            ...internalContext,
            ...connectionContext,
        })
        : context;
    let params = {
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
        ? (0, graphql_1.subscribe)({
            contextValue: processedContext,
            document,
            fieldResolver,
            operationName: params.operationName,
            rootValue,
            schema: params.schema || schema,
            variableValues: params.variables,
        })
        : (0, graphql_1.execute)({
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
exports.execute = execute;
