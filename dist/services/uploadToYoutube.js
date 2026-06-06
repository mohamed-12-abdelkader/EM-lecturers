"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadToYouTube = uploadToYouTube;
const fs_1 = __importDefault(require("fs"));
const googleapis_1 = require("googleapis");
const utils_1 = require("../utils");
const { GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: CLIENT_SECRET } = utils_1.config;
const SCOPES = [
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube',
    'https://www.googleapis.com/auth/youtubepartner',
    'https://www.googleapis.com/auth/youtube.force-ssl',
];
const REDIRECT_URL = 'http://localhost:3000/oauth2callback';
// const TOKEN_PATH = path.join('../', 'token.json');
const TOKEN_PATH = 'token.json';
// OAuth2 client
async function getAuthClient() {
    const oAuth2Client = new googleapis_1.google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URL);
    if (fs_1.default.existsSync(TOKEN_PATH)) {
        const token = JSON.parse(fs_1.default.readFileSync(TOKEN_PATH, 'utf-8'));
        oAuth2Client.setCredentials(token);
        return oAuth2Client;
    }
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
    });
    console.log('Authorize this app by visiting this URL:', authUrl);
    const readline = await import('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise((resolve, reject) => {
        rl.question('Enter the code from that page here: ', async (code) => {
            rl.close();
            try {
                const { tokens } = await oAuth2Client.getToken(code);
                oAuth2Client.setCredentials(tokens);
                fs_1.default.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
                console.log('Token stored to', TOKEN_PATH);
                resolve(oAuth2Client);
            }
            catch (err) {
                reject(err);
            }
        });
    });
}
// Reusable upload function
async function uploadToYouTube(options) {
    const { filePath, title = 'Untitled', description = '', tags = [], privacyStatus = 'unlisted', } = options;
    if (!fs_1.default.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
    }
    const auth = await getAuthClient();
    const youtube = googleapis_1.google.youtube({ version: 'v3', auth });
    const response = await youtube.videos.insert({
        part: ['snippet', 'status'],
        requestBody: {
            snippet: {
                title,
                description,
                tags,
                categoryId: '22', // People & Blogs
            },
            status: {
                privacyStatus,
            },
        },
        media: {
            body: fs_1.default.createReadStream(filePath),
        },
    });
    return response.data;
}
// Example usage:
// uploadToYouTube({ filePath: './video.mp4' }).then((res) => {
//   console.log(res);
// });
