export interface ProfileCandidate {
  profileId: number; versionId: number; name: string; headerSignature: string[];
}
export interface ProfileDetection extends ProfileCandidate { confidence: number }

export const DETECTION_THRESHOLD = 0.6;

export function detectProfile(headers: string[], candidates: ProfileCandidate[]): ProfileDetection | null {
  const headerSet = new Set(headers);
  let best: ProfileDetection | null = null;
  for (const c of candidates) {
    if (c.headerSignature.length === 0) continue;
    const matched = c.headerSignature.filter(h => headerSet.has(h)).length;
    const confidence = matched / c.headerSignature.length;
    if (confidence >= DETECTION_THRESHOLD && (best === null || confidence > best.confidence)) {
      best = { ...c, confidence };
    }
  }
  return best;
}
