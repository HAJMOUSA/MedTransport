import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuthStore } from '../../hooks/useAuth';
import type { WizardState } from './types';

export function ValidateStep({ state, update }: { state: WizardState; update: (p: Partial<WizardState>) => void }) {
  const isAdmin = useAuthStore(s => s.user?.role === 'admin');
  const [confirmText, setConfirmText] = useState('');
  const analysis = state.analysis!;

  const grouped = useMemo(() => {
    const map = new Map<string, typeof analysis.issues>();
    for (const issue of analysis.issues) {
      const list = map.get(issue.code) ?? [];
      list.push(issue);
      map.set(issue.code, list);
    }
    return [...map.entries()];
  }, [analysis.issues]);

  const execute = useMutation({
    mutationFn: () => api.post('/api/import/trips/execute', {
      uploadId: state.upload!.uploadId,
      profileVersionId: state.profileVersionId,
      profileId: state.profileId,
      mappingOverrides: state.mappingOverrides,
      mode: state.mode,
      duplicatePolicy: state.duplicatePolicy,
    }).then(r => r.data),
    onSuccess: data => update({ jobId: data.jobId, step: 5 }),
  });

  const needsConfirm = state.mode !== 'test';
  const canExecute = !execute.isPending && (!needsConfirm || confirmText === 'IMPORT');

  return (
    <div className="space-y-6">
      {/* Issues grouped by code */}
      <div className="space-y-3">
        {grouped.length === 0 && <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-3">No issues found — all rows are valid.</p>}
        {grouped.map(([code, issues]) => (
          <details key={code} className="bg-white border border-gray-200 rounded-lg">
            <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-gray-800">
              <span className={`inline-block w-2 h-2 rounded-full mr-2 ${issues[0].severity === 'error' ? 'bg-red-500' : 'bg-amber-500'}`} />
              {code} <span className="text-gray-400 font-normal">({issues.length} row{issues.length === 1 ? '' : 's'})</span>
            </summary>
            <div className="px-4 pb-3 text-xs text-gray-600 space-y-1">
              <p className="text-gray-500 mb-2">{issues[0].guidance}</p>
              {issues.slice(0, 20).map((i, idx) => (
                <p key={idx}>Row {i.row}{i.sourceTripId ? ` · ${i.sourceTripId}` : ''}{i.field ? ` · ${i.field}` : ''}</p>
              ))}
              {issues.length > 20 && <p className="text-gray-400">…and {issues.length - 20} more (download the error CSV after import for the full list)</p>}
            </div>
          </details>
        ))}
      </div>

      {/* Mode + duplicate policy */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Import mode</label>
          {([
            { value: 'test', label: 'Test mode — validate only, create nothing', admin: false, hint: null },
            { value: 'valid_rows_only', label: 'Import valid rows, skip errors', admin: false, hint: null },
            { value: 'all_or_nothing', label: 'All-or-nothing', admin: true, hint: 'If any row is invalid the job fails and nothing is imported.' },
          ] as const).map(opt => (
            <label key={opt.value} className={`flex items-start gap-2 text-sm py-1 ${opt.admin && !isAdmin ? 'opacity-40' : ''}`}>
              <input type="radio" name="mode" value={opt.value} checked={state.mode === opt.value}
                disabled={opt.admin && !isAdmin}
                onChange={() => update({ mode: opt.value })} className="mt-1" />
              <span>
                {opt.label}
                {opt.admin && <span className="ml-1 text-xs text-gray-400">(admin only)</span>}
                {opt.hint && <span className="block text-xs text-gray-400">{opt.hint}</span>}
              </span>
            </label>
          ))}
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Duplicate policy</label>
          {([
            { value: 'skip', label: 'Skip duplicates', admin: false },
            { value: 'reject', label: 'Reject duplicates as errors', admin: false },
            { value: 'update', label: 'Update existing trips', admin: true },
          ] as const).map(opt => (
            <label key={opt.value} className={`flex items-start gap-2 text-sm py-1 ${opt.admin && !isAdmin ? 'opacity-40' : ''}`}>
              <input type="radio" name="policy" value={opt.value} checked={state.duplicatePolicy === opt.value}
                disabled={opt.admin && !isAdmin}
                onChange={() => update({ duplicatePolicy: opt.value })} className="mt-1" />
              <span>
                {opt.label}
                {opt.admin && <span className="ml-1 text-xs text-gray-400">(admin only)</span>}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Confirm + execute */}
      {needsConfirm && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-sm text-amber-800 mb-2">
            This will create or update trip records. Type <strong>IMPORT</strong> to confirm.
          </p>
          <input value={confirmText} onChange={e => setConfirmText(e.target.value)}
            className="border border-amber-300 rounded-lg px-3 py-2 text-sm w-40" placeholder="IMPORT" />
        </div>
      )}

      {execute.isError && (
        <p className="text-sm text-red-600">
          {(() => { const err = execute.error as { response?: { data?: { error?: string } }; message?: string }; return err.response?.data?.error ?? err.message; })()}
        </p>
      )}

      <div className="flex items-center justify-between">
        <button onClick={() => update({ step: 3 })} className="text-sm text-gray-500 hover:underline">← Back to preview</button>
        <button
          disabled={!canExecute}
          onClick={() => execute.mutate()}
          className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-5 py-2.5 text-sm font-medium disabled:opacity-40"
        >
          {execute.isPending ? 'Starting…' : state.mode === 'test' ? 'Run test' : 'Run import'}
        </button>
      </div>
    </div>
  );
}
