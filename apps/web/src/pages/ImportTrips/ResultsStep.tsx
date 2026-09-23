import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { WizardState } from './types';

interface JobStatus {
  id: number; status: string; mode: string; total_rows: number;
  imported_rows: number; updated_rows: number; skipped_rows: number;
  duplicate_rows: number; error_rows: number; completed_at: string | null;
}

export function ResultsStep({ state, update }: { state: WizardState; update: (p: Partial<WizardState>) => void }) {
  const { data: job } = useQuery<JobStatus>({
    queryKey: ['import-job', state.jobId],
    queryFn: () => api.get(`/api/import/trips/jobs/${state.jobId}`).then(r => r.data),
    refetchInterval: query => (query.state.data?.status === 'processing' ? 2000 : false),
    enabled: state.jobId !== null,
  });

  const downloadErrors = async () => {
    const res = await api.get(`/api/import/trips/jobs/${state.jobId}/errors.csv`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `import-${state.jobId}-errors.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const reset = () => update({
    step: 1, upload: null, profileId: null, profileVersionId: null,
    mappingOverrides: {}, analysis: null, jobId: null,
    mode: 'valid_rows_only', duplicatePolicy: 'skip',
  });

  if (!job) return <p className="text-sm text-gray-500">Loading job…</p>;

  const failed = job.status === 'failed';

  return (
    <div className="space-y-6">
      <div className={`rounded-xl p-5 ${failed ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
        <h2 className={`text-lg font-bold ${failed ? 'text-red-800' : 'text-green-800'}`}>
          {job.status === 'processing' ? 'Import running…' : failed ? 'Import failed' : job.mode === 'test' ? 'Test complete' : 'Import complete'}
        </h2>
        {job.status === 'failed' && (
          <p className="text-sm text-red-700 mt-1">
            {job.mode === 'all_or_nothing' ? 'All-or-nothing mode: invalid rows were found, so nothing was imported. Fix the errors and re-run.' : 'The import job failed. Check the error CSV for details.'}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-center">
        {[
          { label: 'Total', value: job.total_rows },
          { label: 'Created', value: job.imported_rows },
          { label: 'Updated', value: job.updated_rows },
          { label: 'Skipped', value: job.skipped_rows },
          { label: 'Duplicates', value: job.duplicate_rows },
          { label: 'Failed', value: job.error_rows },
        ].map(s => (
          <div key={s.label} className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
            <p className="text-xs text-gray-500">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button onClick={downloadErrors}
          className="border border-gray-300 text-gray-700 rounded-lg px-4 py-2 text-sm font-medium hover:bg-gray-50">
          Download error CSV
        </button>
        <button onClick={reset} className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm font-medium">
          Import another file
        </button>
      </div>
    </div>
  );
}
