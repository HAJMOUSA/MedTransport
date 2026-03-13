import { useState, useRef, useCallback } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import {
  Upload,
  FileText,
  Download,
  X,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
} from 'lucide-react';

interface ImportJob {
  id: number;
  status: 'processing' | 'completed' | 'failed';
  total_rows: number;
  imported_rows: number;
  skipped_rows: number;
  error_rows: number;
  errors: Array<{ row: number; error: string }> | null;
  filename: string;
  completed_at: string | null;
}

interface CSVImportProps {
  onClose: () => void;
  onComplete?: () => void;
}

export function CSVImport({ onClose, onComplete }: CSVImportProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [jobId, setJobId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Poll job status once we have a jobId
  const { data: job } = useQuery<ImportJob>({
    queryKey: ['import-job', jobId],
    queryFn: () => api.get(`/api/import/jobs/${jobId}`).then(r => r.data),
    enabled: jobId !== null,
    refetchInterval: (query) => {
      const data = query.state.data as ImportJob | undefined;
      if (!data) return 1000;
      return data.status === 'processing' ? 1500 : false;
    },
  });

  const upload = useMutation({
    mutationFn: (f: File) => {
      const form = new FormData();
      form.append('file', f);
      return api.post<{ jobId: number }>('/api/import/riders', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }).then(r => r.data);
    },
    onSuccess: (data) => {
      setJobId(data.jobId);
    },
  });

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped?.name.endsWith('.csv')) {
      setFile(dropped);
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setFile(f);
  };

  const reset = () => {
    setFile(null);
    setJobId(null);
    upload.reset();
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const isProcessing = job?.status === 'processing' || upload.isPending;
  const isDone = job?.status === 'completed';
  const isFailed = job?.status === 'failed';

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-label="Import Riders CSV">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-lg font-bold text-gray-900">Import Riders via CSV</h2>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-100" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Template download */}
          <div className="flex items-center justify-between bg-blue-50 rounded-lg px-4 py-3">
            <div>
              <p className="text-sm font-medium text-blue-900">Need a template?</p>
              <p className="text-xs text-blue-600">Download our pre-formatted CSV template</p>
            </div>
            <a
              href="/api/import/template/riders"
              download
              className="flex items-center gap-1.5 text-sm font-medium text-blue-700 hover:text-blue-800 bg-white border border-blue-200 rounded-lg px-3 py-1.5 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Template
            </a>
          </div>

          {/* Drop zone — only shown before upload starts */}
          {!jobId && (
            <div>
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`
                  border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors
                  ${isDragging ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'}
                `}
                role="button"
                tabIndex={0}
                aria-label="Drop CSV file or click to browse"
              >
                <Upload className={`w-10 h-10 mx-auto mb-3 ${isDragging ? 'text-blue-500' : 'text-gray-400'}`} />
                {file ? (
                  <div>
                    <div className="flex items-center justify-center gap-2 mb-1">
                      <FileText className="w-4 h-4 text-green-500" />
                      <p className="text-sm font-medium text-gray-900">{file.name}</p>
                    </div>
                    <p className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)} KB</p>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm font-medium text-gray-700">Drop your CSV file here</p>
                    <p className="text-xs text-gray-500 mt-1">or click to browse · Max 20 MB</p>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFileChange}
                  className="hidden"
                  aria-hidden
                />
              </div>

              {/* Column guide */}
              <div className="mt-3 bg-gray-50 rounded-lg p-3">
                <p className="text-xs font-medium text-gray-700 mb-2">Expected columns (order doesn't matter):</p>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { col: 'name', req: true },
                    { col: 'phone', req: true },
                    { col: 'address', req: false },
                    { col: 'mobility_type', req: false },
                    { col: 'insurance_name', req: false },
                    { col: 'insurance_id', req: false },
                    { col: 'emergency_contact', req: false },
                    { col: 'notes', req: false },
                  ].map(({ col, req }) => (
                    <span
                      key={col}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono ${
                        req ? 'bg-blue-100 text-blue-800' : 'bg-gray-200 text-gray-700'
                      }`}
                    >
                      {col}
                      {req && <span className="text-red-500 font-bold">*</span>}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Upload error */}
          {upload.error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{(upload.error as Error).message}</p>
            </div>
          )}

          {/* Job progress */}
          {job && (
            <div className={`rounded-xl border p-4 space-y-3 ${
              isDone ? 'border-green-200 bg-green-50' :
              isFailed ? 'border-red-200 bg-red-50' :
              'border-blue-200 bg-blue-50'
            }`}>
              <div className="flex items-center gap-2">
                {isProcessing && <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />}
                {isDone && <CheckCircle2 className="w-4 h-4 text-green-600" />}
                {isFailed && <AlertCircle className="w-4 h-4 text-red-500" />}
                <span className="text-sm font-medium">
                  {isProcessing ? 'Processing import…' : isDone ? 'Import complete' : 'Import failed'}
                </span>
              </div>

              {/* Stats */}
              {(isDone || isProcessing) && job.total_rows > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Imported', value: job.imported_rows, color: 'text-green-700' },
                    { label: 'Skipped', value: job.skipped_rows, color: 'text-amber-700' },
                    { label: 'Errors', value: job.error_rows, color: 'text-red-700' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="bg-white rounded-lg p-2 text-center">
                      <p className={`text-lg font-bold ${color}`}>{value}</p>
                      <p className="text-xs text-gray-500">{label}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Progress bar */}
              {isProcessing && job.total_rows > 0 && (
                <div className="w-full bg-blue-200 rounded-full h-1.5">
                  <div
                    className="bg-blue-600 h-1.5 rounded-full transition-all"
                    style={{ width: `${Math.round(((job.imported_rows + job.skipped_rows + job.error_rows) / job.total_rows) * 100)}%` }}
                  />
                </div>
              )}

              {/* Error list */}
              {job.errors && job.errors.length > 0 && (
                <div className="max-h-40 overflow-y-auto space-y-1">
                  <p className="text-xs font-medium text-red-700">Row errors:</p>
                  {job.errors.slice(0, 20).map((err, i) => (
                    <div key={i} className="flex gap-2 text-xs">
                      <span className="text-red-500 font-mono shrink-0">Row {err.row}:</span>
                      <span className="text-red-700">{err.error}</span>
                    </div>
                  ))}
                  {job.errors.length > 20 && (
                    <p className="text-xs text-red-600">…and {job.errors.length - 20} more errors</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex gap-3 px-5 pb-5">
          {isDone ? (
            <>
              <button
                onClick={reset}
                className="flex items-center gap-2 flex-1 border border-gray-300 text-gray-700 rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50 justify-center"
              >
                <RefreshCw className="w-4 h-4" />
                Import another
              </button>
              <button
                onClick={() => { onComplete?.(); onClose(); }}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2.5 text-sm font-medium transition-colors"
              >
                Done
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onClose}
                disabled={isProcessing}
                className="flex-1 border border-gray-300 text-gray-700 rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => file && upload.mutate(file)}
                disabled={!file || isProcessing}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50 transition-colors"
              >
                {isProcessing ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Importing…
                  </span>
                ) : 'Start Import'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
