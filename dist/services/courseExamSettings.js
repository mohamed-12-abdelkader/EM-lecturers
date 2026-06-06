"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeNonNegativeHoursIfProvided = exports.normalizeNonNegativeHours = exports.toNumberOrNullIfProvided = exports.toDateOrNullIfProvided = exports.toDateOrNull = exports.buildValidationError = void 0;
const buildValidationError = (message) => {
    const error = new Error(message);
    error.status = 400;
    return error;
};
exports.buildValidationError = buildValidationError;
const toDateOrNull = (value, field) => {
    if (value === undefined || value === null || value === '') {
        return null;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        throw (0, exports.buildValidationError)(`${field} must be a valid ISO date`);
    }
    return parsed;
};
exports.toDateOrNull = toDateOrNull;
const toDateOrNullIfProvided = (value, field) => {
    if (value === undefined) {
        return undefined;
    }
    return (0, exports.toDateOrNull)(value, field);
};
exports.toDateOrNullIfProvided = toDateOrNullIfProvided;
const toNumberOrNullIfProvided = (value, field) => {
    if (value === undefined) {
        return undefined;
    }
    if (value === null) {
        return null;
    }
    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
        throw (0, exports.buildValidationError)(`${field} must be a valid number`);
    }
    return parsed;
};
exports.toNumberOrNullIfProvided = toNumberOrNullIfProvided;
const normalizeNonNegativeHours = (value, field, defaultValue = 0) => {
    if (value === undefined || value === null) {
        return defaultValue;
    }
    const parsed = Number(value);
    if (Number.isNaN(parsed) || parsed < 0) {
        throw (0, exports.buildValidationError)(`${field} must be a non-negative number`);
    }
    return parsed;
};
exports.normalizeNonNegativeHours = normalizeNonNegativeHours;
const normalizeNonNegativeHoursIfProvided = (value, field) => {
    if (value === undefined) {
        return undefined;
    }
    return (0, exports.normalizeNonNegativeHours)(value, field);
};
exports.normalizeNonNegativeHoursIfProvided = normalizeNonNegativeHoursIfProvided;
