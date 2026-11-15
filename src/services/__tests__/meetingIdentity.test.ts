import { describe, expect, it } from 'vitest';
import {
  buildMeetingParticipantIdentity,
  buildScreenShareIdentity,
  identitiesBelongToSameUser,
  normalizeMeetingDeviceRole,
  parseUserIdFromMeetingIdentity,
} from '../meetingIdentity';

describe('meetingIdentity', () => {
  it('builds unique per-device host identities', () => {
    const a = buildMeetingParticipantIdentity({
      userId: 12,
      meetingId: 'abc',
      deviceId: 'web-1',
    });
    const b = buildMeetingParticipantIdentity({
      userId: 12,
      meetingId: 'abc',
      deviceId: 'web-2',
    });
    expect(a).not.toEqual(b);
    expect(parseUserIdFromMeetingIdentity(a)).toBe(12);
    expect(parseUserIdFromMeetingIdentity(b)).toBe(12);
    expect(identitiesBelongToSameUser(a, b)).toBe(true);
  });

  it('parses screen-share identity to the same user', () => {
    const base = buildMeetingParticipantIdentity({
      userId: 9,
      meetingId: 'm1',
      deviceId: 'phone',
    });
    const screen = buildScreenShareIdentity(base);
    expect(parseUserIdFromMeetingIdentity(screen)).toBe(9);
  });

  it('normalizes device roles', () => {
    expect(normalizeMeetingDeviceRole('observer')).toBe('observer');
    expect(normalizeMeetingDeviceRole('CAMERA')).toBe('camera');
    expect(normalizeMeetingDeviceRole('nope')).toBe('general');
  });
});
