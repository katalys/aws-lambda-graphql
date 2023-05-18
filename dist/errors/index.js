"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConnectionNotFoundError = exports.ExtendableError = void 0;
/**
 * Base Error class for all custom errors
 */
class ExtendableError extends Error {
    constructor(message) {
        super(message);
        this.name = this.constructor.name;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.ExtendableError = ExtendableError;
class ConnectionNotFoundError extends ExtendableError {
}
exports.ConnectionNotFoundError = ConnectionNotFoundError;
