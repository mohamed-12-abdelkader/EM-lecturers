import { AccessToken, VideoGrant } from 'livekit-server-sdk';
import { config } from '../utils';

const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = config;

export const getParticipantsCount = async (roomName: string, roomService: any) => {
  try {
    const participants = await roomService.listParticipants(roomName);
    return participants.length;
  } catch {
    return null;
  }
};

type UserRole = 'participant' | 'host' | 'egress';

interface GenerateParticipantTokenParams {
  roomName: string;
  identity: string;
  name: string;
  metadata?: string;
  role?: UserRole; // default: 'participant'
  allowChat?: boolean; // default: true
  canPublishSources?: string[]; // Optional: camera, microphone, screen_share, etc.
  ttl?: string;
  hidden?: boolean;
}

export async function generateParticipantToken({
  roomName,
  identity,
  name,
  metadata,
  role = 'participant',
  allowChat = true,
  ttl = '10m',
  hidden,
  // canPublishSources = [],
}: GenerateParticipantTokenParams): Promise<string> {
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity,
    name,
    ttl,
    metadata,
  });

  const videoGrant: VideoGrant = {
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
  } else if (role === 'host') {
    Object.assign(videoGrant, {
      roomAdmin: true,
      roomCreate: true,
      canUpdateOwnMetadata: true,
    });
  } else if (role === 'egress') {
    Object.assign(videoGrant, {
      roomRecord: true,
      canUpdateOwnMetadata: true,
    });
  }

  at.addGrant(videoGrant);
  return await at.toJwt();
}
