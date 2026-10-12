import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Papa from 'papaparse';
import { api } from '../../lib/api';
import { useAuthStore } from '../../hooks/useAuth';

export function ImportProfiles() {
  const queryClient = useQueryClient();
  const isAdmin = useAuthStore(s => s.user?.role === 'admin');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: profiles = [] } = useQuery<Array<{ id: number; name: string; latestVersion: number; created_at: string }>>({
    queryKey: ['import-profiles'],
    queryFn: () => api.get('/api/import/profiles').then(r => r.data),
  });

  const { data: detail } = useQuery({
    queryKey: ['import-profile', expandedId],
    queryFn: () => api.get(`/api/import/profiles/${expandedId}`).then(r => r.data),
    enabled: expandedId !== null,
  });

  const createProfile = useMutation({
    mutationFn: (payload: { name: string; config: unknown }) =>
      api.post('/api/import/profiles', payload).then(r => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['import-profiles'] }),
    onError: e => setError((e as Error).message),
  });

  const renameProfile = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      api.patch(`/api/import/profiles/${id}`, { name }).then(r => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['import-profiles'] }),
    onError: e => setError((e as Error).message),
  });

  const deleteProfile = useMutation({
    mutationFn: (id: number) => api.delete(`/api/import/profiles/${id}`),
    onSuccess: () => { setExpandedId(null); queryClient.invalidateQueries({ queryKey: ['import-profiles'] }); },
    onError: e => setError((e as Error).message),
  });

  const handleFile = (file: File) => {
    Papa.parse<string[]>(file, {
      preview: 1,
      complete: results => {
        const headers = results.data[0]?.map(h => h.trim()).filter(Boolean) ?? [];
        if (headers.length === 0) { setError('Could not read headers from that file'); return; }
        const name = window.prompt('Name for the new vendor profile (e.g. "MTM", "ModivCare"):');
        if (!name) return;
        createProfile.mutate({
          name,
          config: {
            headerSignature: headers,
            columnMap: {},
            encoding: 'auto', delimiter: ',',
            dateFormat: 'M/d/yyyy', timeFormat: 'H:mm', dateTimeFormat: 'iso',
            timezone: 'America/New_York',
            valueTranslations: {}, defaults: {}, requiredOverrides: [],
          },
        });
      },
    });
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Vendor Import Profiles</h1>
          <p className="text-sm text-gray-500 mt-0.5">Saved column mappings for recurring vendor files. Versions are immutable.</p>
        </div>
        {isAdmin && (
          <label className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm font-medium cursor-pointer">
            New profile from CSV
            <input type="file" accept=".csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          </label>
        )}
      </div>
      {error && <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{error}</p>}

      <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
        {profiles.length === 0 && <p className="p-6 text-sm text-gray-500">No profiles yet. Upload a vendor CSV in the import wizard or create one here.</p>}
        {profiles.map(p => (
          <div key={p.id}>
            <div className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50">
              <button onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                className="flex-1 flex items-center gap-3 text-left">
                <span className="font-medium text-gray-900">{p.name}</span>
                <span className="text-xs text-gray-400">v{p.latestVersion} · {new Date(p.created_at).toLocaleDateString()}</span>
              </button>
              {isAdmin && (
                <div className="flex items-center gap-3 ml-3">
                  <button
                    onClick={() => { const n = window.prompt('Rename profile:', p.name); if (n && n.trim() && n !== p.name) renameProfile.mutate({ id: p.id, name: n.trim() }); }}
                    className="text-xs text-blue-600 hover:underline">Rename</button>
                  <button
                    onClick={() => { if (window.confirm(`Delete profile "${p.name}"? Imported trips keep their data; the profile is removed from the list.`)) deleteProfile.mutate(p.id); }}
                    className="text-xs text-red-600 hover:underline">Delete</button>
                </div>
              )}
            </div>
            {expandedId === p.id && detail && (
              <div className="px-5 pb-4 space-y-3">
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1">Version history</p>
                  <p className="text-xs text-gray-600">{detail.versions.map((v: { version: number }) => `v${v.version}`).join(' · ')}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1">Latest configuration</p>
                  <pre className="text-xs bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-x-auto max-h-64">{JSON.stringify(detail.latestConfig, null, 2)}</pre>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
