import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuthStore } from '../../hooks/useAuth';
import type { WizardState } from './types';

interface CanonicalField { key: string; label: string; type: string; required: boolean; description: string }
interface ProfileListItem { id: number; name: string; latestVersion: number | null }
interface ProfileDetail {
  id: number; name: string; is_active: boolean;
  versions: Array<{ id: number; version: number; created_at: string }>;
  latestConfig: (Record<string, unknown> & { columnMap?: Record<string, string> }) | null;
}

export function MapStep({ state, update }: { state: WizardState; update: (p: Partial<WizardState>) => void }) {
  const user = useAuthStore(s => s.user);
  const isAdmin = user?.role === 'admin';
  const [error, setError] = useState<string | null>(null);

  const { data: fields = [] } = useQuery<CanonicalField[]>({
    queryKey: ['canonical-fields'],
    queryFn: () => api.get('/api/import/trips/canonical-fields').then(r => r.data),
  });
  const { data: profiles = [] } = useQuery<ProfileListItem[]>({
    queryKey: ['import-profiles'],
    queryFn: () => api.get('/api/import/profiles').then(r => r.data),
  });
  const { data: profileDetail } = useQuery<ProfileDetail>({
    queryKey: ['import-profile', state.profileId],
    queryFn: () => api.get(`/api/import/profiles/${state.profileId}`).then(r => r.data),
    enabled: state.profileId !== null,
  });

  // Effective mapping = saved profile mapping + in-flight overrides
  const savedMap: Record<string, string> = useMemo(
    () => profileDetail?.latestConfig?.columnMap ?? {},
    [profileDetail]
  );
  const effective = useMemo(() => ({ ...savedMap, ...state.mappingOverrides }), [savedMap, state.mappingOverrides]);

  const [draftProfileId, setDraftProfileId] = useState<number | null>(state.profileId);

  // When profile selection changes, reset overrides; the version id is resolved
  // from the profile detail query once it loads (see effect below).
  useEffect(() => {
    if (draftProfileId !== state.profileId) {
      update({ profileId: draftProfileId, profileVersionId: null, mappingOverrides: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftProfileId]);

  // Resolve the latest version row id from the profile detail (versions sorted DESC).
  useEffect(() => {
    if (state.profileId !== null && state.profileVersionId === null && profileDetail?.versions?.length) {
      update({ profileVersionId: profileDetail.versions[0].id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileDetail, state.profileId, state.profileVersionId]);

  const requiredKeys = fields.filter(f => f.required).map(f => f.key);
  const mappedTargets = new Set(Object.values(effective).map(t => t.split('.')[0]));
  const missingRequired = requiredKeys.filter(k => !mappedTargets.has(k));

  const mappingOptions = fields.flatMap(f => {
    if (f.type === 'datetime') return [
      { value: f.key, label: `${f.label} (single column)` },
      { value: `${f.key}.date`, label: `${f.label} — date part` },
      { value: `${f.key}.time`, label: `${f.label} — time part` },
    ];
    if (f.type === 'address') return ['street', 'city', 'state', 'zip'].map(part => ({
      value: `${f.key}.${part}`, label: `${f.label} — ${part}`,
    }));
    return [{ value: f.key, label: f.label }];
  });

  // Strip "— ignore —" ('') entries before persisting a config
  const cleanedMap = (map: Record<string, string>) =>
    Object.fromEntries(Object.entries(map).filter(([, target]) => target !== ''));

  return (
    <div className="space-y-6">
      {/* Detection banner */}
      {state.upload?.detectedProfile && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
          Auto-detected profile <strong>{state.upload.detectedProfile.name}</strong> ({Math.round(state.upload.detectedProfile.confidence * 100)}% header match). Review the mapping below before continuing.
        </div>
      )}

      {/* Profile selector */}
      <div className="flex items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Vendor profile</label>
          <select
            value={draftProfileId ?? ''}
            onChange={e => setDraftProfileId(e.target.value ? Number(e.target.value) : null)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">— No profile (map manually) —</option>
            {profiles.map(p => <option key={p.id} value={p.id}>{p.name} (v{p.latestVersion ?? 0})</option>)}
          </select>
        </div>
      </div>

      {/* Column mapping table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left px-4 py-3 font-medium text-gray-600">Source column ({state.upload?.headers.length ?? 0})</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Maps to canonical field</th>
            </tr>
          </thead>
          <tbody>
            {state.upload?.headers.map(h => (
              <tr key={h} className="border-b border-gray-50">
                <td className="px-4 py-2 font-mono text-xs text-gray-800">{h}</td>
                <td className="px-4 py-2">
                  <select
                    value={effective[h] ?? ''}
                    onChange={e => update({ mappingOverrides: { ...state.mappingOverrides, [h]: e.target.value } })}
                    className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm w-full max-w-xs"
                  >
                    <option value="">— ignore —</option>
                    {mappingOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Missing-required warning */}
      {missingRequired.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
          Required fields not yet mapped: <strong>{missingRequired.join(', ')}</strong>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Actions */}
      <div className="flex items-center justify-between">
        <button onClick={() => update({ step: 1 })} className="text-sm text-gray-500 hover:underline">← Back</button>
        <div className="flex gap-2">
          {isAdmin && state.profileId !== null && profileDetail?.latestConfig && (
            <SaveVersionButton
              profileId={state.profileId}
              config={{ ...profileDetail.latestConfig, columnMap: cleanedMap(effective) }}
              onSaved={versionId => update({ profileVersionId: versionId, mappingOverrides: {} })}
              onError={setError}
            />
          )}
          {isAdmin && state.profileId === null && state.upload && (
            <SaveAsNewProfileButton
              headers={state.upload.headers}
              columnMap={cleanedMap(effective)}
              onSaved={(profileId, versionId) => {
                setDraftProfileId(profileId);
                update({ profileId, profileVersionId: versionId, mappingOverrides: {} });
              }}
              onError={setError}
            />
          )}
          <button
            disabled={!(missingRequired.length === 0 && (state.profileVersionId !== null || state.profileId === null))}
            onClick={() => {
              // Profileless import: carry the effective mapping as an unsaved inline config.
              // A selected profile keeps inlineConfig null so the saved version is used instead.
              const inlineConfig = state.profileVersionId === null
                ? {
                    headerSignature: state.upload!.headers,
                    columnMap: cleanedMap(effective),
                    encoding: 'auto',
                    delimiter: ',',
                    dateFormat: 'M/d/yyyy',
                    timeFormat: 'H:mm',
                    dateTimeFormat: 'iso',
                    timezone: 'America/New_York',
                    valueTranslations: {},
                    defaults: {},
                    requiredOverrides: [],
                  }
                : null;
              update({ inlineConfig, step: 3 });
            }}
            className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-40"
          >
            Continue to preview →
          </button>
        </div>
      </div>
    </div>
  );
}

function SaveVersionButton({ profileId, config, onSaved, onError }: {
  profileId: number;
  config: Record<string, unknown>;
  onSaved: (versionId: number) => void;
  onError: (msg: string) => void;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const { data } = await api.post<{ versionId: number; version: number }>(
            `/api/import/profiles/${profileId}/versions`, { config }
          );
          queryClient.invalidateQueries({ queryKey: ['import-profiles'] });
          queryClient.invalidateQueries({ queryKey: ['import-profile', profileId] });
          onSaved(data.versionId);
        } catch (e) {
          onError(e instanceof Error ? e.message : 'Save failed');
        } finally { setBusy(false); }
      }}
      className="border border-gray-300 text-gray-700 rounded-lg px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-40"
    >
      {busy ? 'Saving…' : 'Save mapping as new version'}
    </button>
  );
}

function SaveAsNewProfileButton({ headers, columnMap, onSaved, onError }: {
  headers: string[];
  columnMap: Record<string, string>;
  onSaved: (profileId: number, versionId: number) => void;
  onError: (msg: string) => void;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        const name = window.prompt('Name for the new vendor profile:');
        if (!name) return;
        setBusy(true);
        try {
          const config = {
            headerSignature: headers,
            columnMap,
            encoding: 'auto',
            delimiter: ',',
            dateFormat: 'M/d/yyyy',
            timeFormat: 'H:mm',
            dateTimeFormat: 'iso',
            timezone: 'America/New_York',
            valueTranslations: {},
            defaults: {},
            requiredOverrides: [],
          };
          const { data } = await api.post<{ profileId: number; versionId: number }>(
            '/api/import/profiles', { name, config }
          );
          queryClient.invalidateQueries({ queryKey: ['import-profiles'] });
          queryClient.invalidateQueries({ queryKey: ['import-profile', data.profileId] });
          onSaved(data.profileId, data.versionId);
        } catch (e) {
          onError(e instanceof Error ? e.message : 'Save failed');
        } finally { setBusy(false); }
      }}
      className="border border-gray-300 text-gray-700 rounded-lg px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-40"
    >
      {busy ? 'Saving…' : 'Save as new profile'}
    </button>
  );
}
