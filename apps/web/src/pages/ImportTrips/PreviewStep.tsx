import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { WizardState, AnalysisResult } from './types';

export function PreviewStep({ state, update }: { state: WizardState; update: (p: Partial<WizardState>) => void }) {
  const { data, isLoading, error } = useQuery<AnalysisResult>({
    queryKey: ['import-analyze', state.upload?.uploadId, state.profileVersionId, state.inlineConfig, state.mappingOverrides],
    queryFn: () => api.post('/api/import/trips/analyze', {
      uploadId: state.upload!.uploadId,
      mappingOverrides: state.mappingOverrides,
      ...(state.profileVersionId
        ? { profileVersionId: state.profileVersionId }
        : { inlineConfig: state.inlineConfig }),
    }).then(r => r.data),
    enabled: state.upload !== null && (state.profileVersionId !== null || state.inlineConfig !== null),
  });

  if (isLoading) return <p className="text-sm text-gray-500">Analyzing file…</p>;
  if (error) {
    const err = error as { response?: { data?: { error?: string } }; message?: string };
    return <p className="text-sm text-red-600">{err.response?.data?.error ?? err.message}</p>;
  }
  if (!data) return null;

  const c = data.counts;
  return (
    <div className="space-y-6">
      {/* Transformation notices */}
      {data.notices.length > 0 && (
        <ul className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm text-gray-700 list-disc list-inside">
          {data.notices.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}

      {/* Count chips */}
      <div className="flex flex-wrap gap-3">
        <Chip label="Total rows" value={c.total} tone="gray" />
        <Chip label="Valid" value={c.valid} tone="green" />
        <Chip label="Warnings" value={c.warning} tone="amber" />
        <Chip label="Invalid" value={c.invalid} tone="red" />
        <Chip label="Duplicates" value={c.duplicates} tone="amber" />
        <Chip label="Matched passengers" value={c.matchedRiders} tone="blue" />
        <Chip label="New passengers" value={c.newRiders} tone="blue" />
      </div>
      {c.newRiders > 0 && (
        <p className="text-sm text-blue-800 bg-blue-50 border border-blue-200 rounded-lg p-3">
          {c.newRiders} new passenger record{c.newRiders === 1 ? '' : 's'} will be created from trip rows (no existing match by name + date of birth or phone).
        </p>
      )}

      {/* Masked sample */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              {['Row', 'Status', 'Trip ID', 'Passenger', 'Phone', 'Medical ID', 'Pickup at', 'Pickup', 'Drop-off'].map(h => (
                <th key={h} className="text-left px-3 py-2 font-medium text-gray-600 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.sample.map(r => (
              <tr key={r.row} className="border-b border-gray-50">
                <td className="px-3 py-2 text-gray-500">{r.row}</td>
                <td className="px-3 py-2"><StatusDot status={r.status} /></td>
                <td className="px-3 py-2 font-mono text-xs">{r.externalTripId}</td>
                <td className="px-3 py-2">{r.passengerName}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.primaryPhone}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.medicalId ?? ''}</td>
                <td className="px-3 py-2 text-xs">{r.pickupAt ? new Date(r.pickupAt).toLocaleString() : '—'}</td>
                <td className="px-3 py-2 text-xs">{r.pickupAddress}</td>
                <td className="px-3 py-2 text-xs">{r.dropoffAddress}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400">Showing first {data.sample.length} rows. Phone numbers and medical IDs are masked in this preview.</p>

      {/* Unmapped columns */}
      {data.unmapped.length > 0 && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
          Unmapped source columns (ignored): <span className="font-mono text-xs">{data.unmapped.join(', ')}</span>
        </p>
      )}

      <div className="flex items-center justify-between">
        <button onClick={() => update({ step: 2 })} className="text-sm text-gray-500 hover:underline">← Back to mapping</button>
        <button
          onClick={() => update({ analysis: data, step: 4 })}
          className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm font-medium"
        >
          Continue to validation →
        </button>
      </div>
    </div>
  );
}

function Chip({ label, value, tone }: { label: string; value: number; tone: 'gray' | 'green' | 'amber' | 'red' | 'blue' }) {
  const colors = { gray: 'bg-gray-100 text-gray-800', green: 'bg-green-100 text-green-800', amber: 'bg-amber-100 text-amber-800', red: 'bg-red-100 text-red-800', blue: 'bg-blue-100 text-blue-800' };
  return (
    <div className={`${colors[tone]} rounded-lg px-3 py-2`}>
      <span className="text-lg font-bold">{value}</span>
      <span className="text-xs ml-1.5">{label}</span>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const color = status === 'valid' ? 'bg-green-500' : status === 'warning' ? 'bg-amber-500' : 'bg-red-500';
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${color}`} title={status} />;
}
