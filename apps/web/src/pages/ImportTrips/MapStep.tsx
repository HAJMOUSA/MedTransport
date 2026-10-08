import { useEffect, useMemo, useRef, useState } from 'react';
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
  const suggestedMap: Record<string, string> = useMemo(
    () => state.upload?.suggestedMap ?? {},
    [state.upload]
  );
  // Precedence: user edits > saved profile mapping > auto-suggested
  const effective = useMemo(
    () => ({ ...suggestedMap, ...savedMap, ...state.mappingOverrides }),
    [suggestedMap, savedMap, state.mappingOverrides]
  );

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

  // Seed value-translations + formats from the selected profile's config (once per
  // profile), or reset to defaults when no profile is selected. User edits then
  // live directly in wizard state.
  const appliedProfileRef = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    if (state.profileId === null) {
      if (appliedProfileRef.current !== null) {
        appliedProfileRef.current = null;
        update({ valueTranslations: {}, dateFormat: 'M/d/yyyy', timeFormat: 'h:mm a', timezone: 'America/New_York' });
      }
      return;
    }
    const c = profileDetail?.latestConfig as (Record<string, unknown> & {
      valueTranslations?: Record<string, Record<string, string>>;
      dateFormat?: string; timeFormat?: string; timezone?: string;
    }) | null | undefined;
    if (c && appliedProfileRef.current !== state.profileId) {
      appliedProfileRef.current = state.profileId;
      update({
        valueTranslations: c.valueTranslations ?? {},
        dateFormat: c.dateFormat ?? 'M/d/yyyy',
        timeFormat: c.timeFormat ?? 'h:mm a',
        timezone: c.timezone ?? 'America/New_York',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.profileId, profileDetail]);

  // Columns whose canonical target is a controlled/boolean field → value translations apply.
  const fieldType = useMemo(() => Object.fromEntries(fields.map(f => [f.key, f.type])), [fields]);
  const fieldLabel = useMemo(() => Object.fromEntries(fields.map(f => [f.key, f.label])), [fields]);
  const sampleValues = state.upload?.sampleValues ?? {};
  const translatableColumns = Object.entries(effective)
    .map(([header, target]) => ({ header, key: target.split('.')[0] }))
    .filter(({ key }) => fieldType[key] === 'controlled' || fieldType[key] === 'boolean');

  const setTranslation = (key: string, source: string, target: string) => {
    const next = { ...state.valueTranslations, [key]: { ...(state.valueTranslations[key] ?? {}) } };
    if (target === '') delete next[key][source]; else next[key][source] = target;
    update({ valueTranslations: next });
  };

  const requiredKeys = fields.filter(f => f.required).map(f => f.key);
  const mappedTargets = new Set(Object.values(effective).map(t => t.split('.')[0]));
  // Engine falls back pickup_at ← appointment_at, so a mapped appointment_at covers pickup_at
  if (mappedTargets.has('appointment_at')) mappedTargets.add('pickup_at');
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
        <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-100">
          {Object.keys(suggestedMap).length > 0 ? (
            <span className="text-xs text-gray-500">
              Fields are auto-matched where confident — review and adjust as needed.
            </span>
          ) : <span />}
          {Object.keys(state.mappingOverrides).length > 0 && (
            <button
              type="button"
              onClick={() => update({ mappingOverrides: {} })}
              className="text-xs text-blue-600 hover:underline"
            >
              Reset manual edits
            </button>
          )}
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left px-4 py-3 font-medium text-gray-600">Source column ({state.upload?.headers.length ?? 0})</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Maps to canonical field</th>
            </tr>
          </thead>
          <tbody>
            {state.upload?.headers.map(h => {
              const val = effective[h] ?? '';
              const isAuto = val !== '' && !(h in savedMap) && !(h in state.mappingOverrides) && suggestedMap[h] === val;
              return (
                <tr key={h} className="border-b border-gray-50">
                  <td className="px-4 py-2 font-mono text-xs text-gray-800">{h}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <select
                        value={val}
                        onChange={e => update({ mappingOverrides: { ...state.mappingOverrides, [h]: e.target.value } })}
                        className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm w-full max-w-xs"
                      >
                        <option value="">— ignore —</option>
                        {mappingOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      {isAuto && (
                        <span
                          title="Auto-matched from your column name — you can change it"
                          className="text-[10px] uppercase tracking-wide text-gray-400 border border-gray-200 rounded px-1.5 py-0.5"
                        >
                          auto
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Date & time formats */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Date &amp; time formats</h3>
        <div className="flex flex-wrap gap-4">
          <label className="text-xs text-gray-600">Date format
            <input value={state.dateFormat} onChange={e => update({ dateFormat: e.target.value })}
              className="mt-1 block border border-gray-300 rounded-lg px-2 py-1.5 text-sm" placeholder="M/d/yyyy" />
          </label>
          <label className="text-xs text-gray-600">Time format
            <input value={state.timeFormat} onChange={e => update({ timeFormat: e.target.value })}
              className="mt-1 block border border-gray-300 rounded-lg px-2 py-1.5 text-sm" placeholder="h:mm a" />
          </label>
          <label className="text-xs text-gray-600">Timezone
            <input value={state.timezone} onChange={e => update({ timezone: e.target.value })}
              className="mt-1 block border border-gray-300 rounded-lg px-2 py-1.5 text-sm" placeholder="America/New_York" />
          </label>
        </div>
        <p className="text-xs text-gray-400 mt-2">Luxon tokens — e.g. <code>M/d/yyyy</code> · <code>h:mm a</code> (12-hour) or <code>H:mm</code> (24-hour) · IANA timezone.</p>
      </div>

      {/* Value translations */}
      {translatableColumns.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-700">Value translations</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Map this file's values to your system's values. Required for controlled fields (Level of Service, Status, Trip Type) and the Will-Call flag — leave blank to keep the original value.
            </p>
          </div>
          {translatableColumns.map(({ header, key }) => {
            const vals = sampleValues[header] ?? [];
            const placeholder =
              key === 'level_of_service' ? 'AMB / WCH / STR'
              : key === 'status' ? 'scheduled / cancelled / completed / no_show'
              : key === 'will_call' ? 'true / false'
              : 'target value';
            return (
              <div key={`${header}:${key}`} className="border-t border-gray-100 pt-3">
                <div className="text-sm font-medium text-gray-800 mb-2">
                  {header} <span className="text-gray-400">→ {fieldLabel[key] ?? key}</span>
                </div>
                {vals.length === 0 ? (
                  <p className="text-xs text-gray-400">No sample values found in this column.</p>
                ) : (
                  <div className="grid sm:grid-cols-2 gap-2">
                    {vals.map(v => (
                      <div key={v} className="flex items-center gap-2">
                        <span className="text-xs text-gray-600 truncate flex-1" title={v}>{v}</span>
                        <span className="text-gray-300 text-xs">→</span>
                        <input
                          value={state.valueTranslations[key]?.[v] ?? ''}
                          onChange={e => setTranslation(key, v, e.target.value)}
                          placeholder={placeholder}
                          className="border border-gray-300 rounded-lg px-2 py-1 text-sm w-40"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

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
              config={{
                ...profileDetail.latestConfig,
                columnMap: cleanedMap(effective),
                valueTranslations: state.valueTranslations,
                dateFormat: state.dateFormat,
                timeFormat: state.timeFormat,
                timezone: state.timezone,
              }}
              onSaved={versionId => update({ profileVersionId: versionId, mappingOverrides: {} })}
              onError={setError}
            />
          )}
          {isAdmin && state.profileId === null && state.upload && (
            <SaveAsNewProfileButton
              headers={state.upload.headers}
              columnMap={cleanedMap(effective)}
              valueTranslations={state.valueTranslations}
              dateFormat={state.dateFormat}
              timeFormat={state.timeFormat}
              timezone={state.timezone}
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
                    dateFormat: state.dateFormat,
                    timeFormat: state.timeFormat,
                    dateTimeFormat: 'iso',
                    timezone: state.timezone,
                    valueTranslations: state.valueTranslations,
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

function SaveAsNewProfileButton({ headers, columnMap, valueTranslations, dateFormat, timeFormat, timezone, onSaved, onError }: {
  headers: string[];
  columnMap: Record<string, string>;
  valueTranslations: Record<string, Record<string, string>>;
  dateFormat: string;
  timeFormat: string;
  timezone: string;
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
            dateFormat,
            timeFormat,
            dateTimeFormat: 'iso',
            timezone,
            valueTranslations,
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
