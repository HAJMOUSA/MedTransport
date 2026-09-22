import { describe, it, expect } from 'vitest';
import { detectProfile } from '../../src/services/importEngine/profiles';

const CANDS = [
  { profileId: 1, versionId: 10, name: 'MTM', headerSignature: ['Trip Number', 'Appointment Date', 'Time', 'Level of Service'] },
  { profileId: 2, versionId: 20, name: 'ModivCare', headerSignature: ['rideId', 'tripId', 'appointmentTime', 'patientFirstName'] },
];

describe('detectProfile', () => {
  it('exact match → confidence 1', () => {
    const d = detectProfile(['Trip Number', 'Appointment Date', 'Time', 'Level of Service'], CANDS);
    expect(d).toMatchObject({ profileId: 1, confidence: 1 });
  });
  it('high partial match wins', () => {
    const d = detectProfile(['Trip Number', 'Appointment Date', 'Time', 'Extra Col'], CANDS);
    expect(d!.profileId).toBe(1);
    expect(d!.confidence).toBeGreaterThanOrEqual(0.6);
  });
  it('returns null below threshold', () => {
    expect(detectProfile(['a', 'b', 'c'], CANDS)).toBeNull();
  });
  it('returns null for no candidates', () => {
    expect(detectProfile(['Trip Number'], [])).toBeNull();
  });
});
