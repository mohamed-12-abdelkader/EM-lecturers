"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseDateInput = exports.parseNumberInput = exports.parseBooleanInput = exports.pickBodyValue = void 0;
const pickBodyValue = (body, ...keys) => {
    for (const key of keys) {
        if (body[key] !== undefined) {
            return body[key];
        }
    }
    return undefined;
};
exports.pickBodyValue = pickBodyValue;
const parseBooleanInput = (value) => {
    if (value === undefined) {
        return undefined;
    }
    if (value === null) {
        return undefined;
    }
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        if (value === 1)
            return true;
        if (value === 0)
            return false;
    }
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', '1', 'yes'].includes(normalized))
            return true;
        if (['false', '0', 'no'].includes(normalized))
            return false;
    }
    return undefined;
};
exports.parseBooleanInput = parseBooleanInput;
const parseNumberInput = (value) => {
    if (value === undefined) {
        return undefined;
    }
    if (value === null || value === '') {
        return null;
    }
    if (typeof value === 'number') {
        return Number.isNaN(value) ? undefined : value;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) {
            return null;
        }
        const parsed = Number(trimmed);
        return Number.isNaN(parsed) ? undefined : parsed;
    }
    return undefined;
};
exports.parseNumberInput = parseNumberInput;
const parseDateInput = (value) => {
    if (value === undefined) {
        return undefined;
    }
    if (value === null || value === '') {
        return null;
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (typeof value === 'string') {
        return value;
    }
    return undefined;
};
exports.parseDateInput = parseDateInput;
