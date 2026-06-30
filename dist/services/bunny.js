"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkFileExistsStorage = checkFileExistsStorage;
exports.uploadToBunnyStorage = uploadToBunnyStorage;
exports.uploadToBunnyStream = uploadToBunnyStream;
const crypto_1 = __importDefault(require("crypto"));
const axios_1 = __importDefault(require("axios"));
const utils_1 = require("../utils");
const fs_1 = __importDefault(require("fs"));
const STORAGE_ZONE_NAME = utils_1.config.BUNNY_STORAGE_ZONE_NAME;
const PUBLIC_HOSTNAME = utils_1.config.BUNNY_STORAGE_PUBLIC_HOSTNAME;
const MEDIA_PATH = utils_1.config.BUNNY_MEDIA_PATH;
const BUNNY_ACCESS_KEY = utils_1.config.BUNNY_ACCESS_KEY;
const STREAM_BASE = utils_1.config.BUNNY_STREAM_BASE;
const STREAM_API_KEY = utils_1.config.BUNNY_STREAM_API_KEY;
const STREAM_EMBED_BASE = utils_1.config.BUNNY_STREAM_EMBED_BASE;
const STREAM_LIBRARY_ID = utils_1.config.BUNNY_STREAM_LIBRARY_ID;
// URL-safe random hash
function generateHash(length) {
    const byteLength = Math.ceil((length * 3) / 4); // Base64 expands data
    const randomBytes = crypto_1.default.randomBytes(byteLength);
    let base64String = randomBytes.toString('base64');
    base64String = base64String.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return base64String.slice(0, length);
}
async function checkFileExistsStorage(fileName) {
    try {
        await axios_1.default.head(`https://${PUBLIC_HOSTNAME}/${MEDIA_PATH}/${fileName}`);
        return true;
    }
    catch (error) {
        if (error.response && error.response.status === 404) {
            return false;
        }
        throw error;
    }
}
async function retryRequest(fn, maxAttempts, delay) {
    let attempts = 0;
    while (attempts < maxAttempts) {
        try {
            return await fn();
        }
        catch (_error) {
            attempts++;
            if (attempts >= maxAttempts) {
                throw new Error('Async process failed!.');
            }
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
    throw new Error('Max attempts reached');
}
async function uploadToBunnyStorage(file, maxAttempts = 2, retryDelay = 0) {
    const hash = generateHash(16) + '.' + file.ext;
    const url = `https://storage.bunnycdn.com/${STORAGE_ZONE_NAME}/${MEDIA_PATH}/${hash}`;
    try {
        await retryRequest(async () => {
            const fileStream = fs_1.default.createReadStream(file.path);
            return axios_1.default.put(url, fileStream, {
                headers: {
                    AccessKey: BUNNY_ACCESS_KEY,
                    'Content-Type': file.mime,
                },
                timeout: 10000,
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
            });
        }, maxAttempts, retryDelay);
        return `https://${PUBLIC_HOSTNAME}/${MEDIA_PATH}/${hash}`;
    }
    catch (error) {
        const detail = error?.response?.status != null
            ? `HTTP ${error.response.status}`
            : error?.message || 'unknown error';
        throw new Error(`Failed to upload to Bunny.net: ${detail}`);
    }
    finally {
        if (file?.path) {
            fs_1.default.unlinkSync(file.path);
        }
    }
}
async function uploadToBunnyStream(file, maxAttempts = 3, retryDelay = 0) {
    try {
        const fileStream = fs_1.default.createReadStream(file.path);
        const createResponse = await axios_1.default.post(STREAM_BASE, {
            title: file.originalname || 'Untitled',
        }, {
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                AccessKey: STREAM_API_KEY,
            },
            timeout: 10000,
        });
        const videoId = createResponse.data.guid;
        const videoUploadUrl = `${STREAM_BASE}/${videoId}`;
        await retryRequest(async () => {
            return axios_1.default.put(videoUploadUrl, fileStream, {
                headers: {
                    'Content-Type': 'application/octet-stream',
                    AccessKey: STREAM_API_KEY,
                },
                timeout: 10000,
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
            });
        }, maxAttempts, retryDelay);
        return `${STREAM_EMBED_BASE}/${STREAM_LIBRARY_ID}/${videoId}`;
    }
    catch (error) {
        throw new Error(`Failed to upload to Bunny Stream: ${error.message}`);
    }
    finally {
        if (file && file.path) {
            fs_1.default.unlinkSync(file.path);
        }
    }
}
