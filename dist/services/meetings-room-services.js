"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getParticipantsCount = void 0;
exports.generateParticipantToken = generateParticipantToken;
const livekit_server_sdk_1 = require("livekit-server-sdk");
const utils_1 = require("../utils");
const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = utils_1.config;
const getParticipantsCount = async (roomName, roomService) => {
    try {
        const participants = await roomService.listParticipants(roomName);
        return participants.length;
    }
    catch {
        return null;
    }
};
exports.getParticipantsCount = getParticipantsCount;
async function generateParticipantToken({ roomName, identity, name, metadata, role = 'participant', allowChat = true, ttl = '10m', hidden,
// canPublishSources = [],
 }) {
    const at = new livekit_server_sdk_1.AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
        identity,
        name,
        ttl,
        metadata,
    });
    const videoGrant = {
        room: roomName,
        roomJoin: true,
        canSubscribe: true,
        canPublishData: allowChat,
        hidden,
    };
    if (role === 'participant') {
        videoGrant.canPublish = false;
        videoGrant.canUpdateOwnMetadata = false;
        // Uncomment if you want to restrict publishing to specific sources
        // videoGrant.canPublishSources = canPublishSources.map(
        //   source => TrackSource[source.toUpperCase() as keyof typeof TrackSource]
        // );
    }
    else if (role === 'host') {
        Object.assign(videoGrant, {
            roomAdmin: true,
            roomCreate: true,
            canUpdateOwnMetadata: true,
        });
    }
    else if (role === 'egress') {
        Object.assign(videoGrant, {
            roomRecord: true,
            canUpdateOwnMetadata: true,
        });
    }
    at.addGrant(videoGrant);
    return await at.toJwt();
}
