import { useState } from 'react';
import { api } from '../../lib/api';
import type { WizardState, UploadInfo } from './types';

export function UploadStep({ state, update }: { state: WizardState; update: (p: Partial<WizardState>) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const send = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) { setError('Only .csv files are accepted'); return; }
    if (file.size > 20 * 1024 * 1024) { setError('File exceeds the 20 MB limit'); return; }
    setBusy(true); setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const { data } = await api.post<UploadInfo>('/api/import/trips/upload', form);
      update({
        upload: data,
        profileId: data.detectedProfile?.profileId ?? null,
        profileVersionId: data.detectedProfile?.versionId ?? null,
        step: 2,
      });
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setError(err.response?.data?.error ?? err.message ?? 'Upload failed');
    } finally { setBusy(false); }
  };

  return (
    <div>
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) send(f); }}
        className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors
          ${dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white'}`}
      >
        <p className="text-lg font-medium text-gray-700 mb-2">Drop your vendor CSV here</p>
        <p className="text-sm text-gray-400 mb-4">or</p>
        <label className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm font-medium cursor-pointer">
          {busy ? 'Uploading…' : 'Choose file'}
          <input type="file" accept=".csv" className="hidden" disabled={busy}
            onChange={e => { const f = e.target.files?.[0]; if (f) send(f); }} />
        </label>
        <p className="text-xs text-gray-400 mt-4">Limits: 20 MB · 10,000 rows · .csv only · UTF-8 or Windows-1252</p>
      </div>
      {error && <p className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{error}</p>}
    </div>
  );
}
