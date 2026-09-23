export interface UploadInfo {
  uploadId: number; filename: string; sha256: string; encoding: string;
  delimiter: string; headers: string[]; rowCount: number;
  detectedProfile: { profileId: number; versionId: number; name: string; confidence: number } | null;
}
export interface AnalysisResult {
  counts: { total: number; valid: number; warning: number; invalid: number; duplicates: number; newRiders: number; matchedRiders: number };
  sample: Array<{ row: number; status: string; externalTripId: string | null; passengerName: string;
    primaryPhone: string; medicalId: string | null; pickupAt: string | null; pickupAddress: string; dropoffAddress: string }>;
  notices: string[];
  issues: Array<{ row: number; sourceTripId: string | null; field: string | null; code: string; guidance: string; severity: string }>;
  headers: string[]; recognized: string[]; unmapped: string[];
}
export interface WizardState {
  step: 1 | 2 | 3 | 4 | 5;
  upload: UploadInfo | null;
  profileId: number | null;         // vendor_profiles.id
  profileVersionId: number | null;  // vendor_profile_versions.id
  mappingOverrides: Record<string, string>;
  analysis: AnalysisResult | null;
  mode: 'test' | 'all_or_nothing' | 'valid_rows_only';
  duplicatePolicy: 'skip' | 'reject' | 'update';
  jobId: number | null;
}
