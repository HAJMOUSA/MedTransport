import { useReducer } from 'react';
import type { WizardState } from './types';
import { UploadStep } from './UploadStep';
import { MapStep } from './MapStep';
import { PreviewStep } from './PreviewStep';
import { ValidateStep } from './ValidateStep';
import { ResultsStep } from './ResultsStep';

export type WizardAction = Partial<WizardState> & { type: 'update' };

function reducer(state: WizardState, action: WizardAction): WizardState {
  const { type: _t, ...patch } = action;
  return { ...state, ...patch };
}

const initial: WizardState = {
  step: 1, upload: null, profileId: null, profileVersionId: null, inlineConfig: null,
  mappingOverrides: {}, valueTranslations: {},
  dateFormat: 'M/d/yyyy', timeFormat: 'h:mm a', timezone: 'America/New_York',
  analysis: null,
  mode: 'valid_rows_only', duplicatePolicy: 'skip', jobId: null,
};

const STEPS = ['Upload', 'Map', 'Preview', 'Validate & Import', 'Results'];

export function ImportTrips() {
  const [state, dispatch] = useReducer(reducer, initial);
  const update = (patch: Partial<WizardState>) => dispatch({ type: 'update', ...patch });

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Import Trips</h1>
      <p className="text-sm text-gray-500 mb-6">Upload a vendor CSV, map columns, preview, and import. Limits: 20 MB, 10,000 rows.</p>

      {/* Stepper */}
      <div className="flex items-center gap-2 mb-8">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold
              ${state.step > i + 1 ? 'bg-green-500 text-white' : state.step === i + 1 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
              {state.step > i + 1 ? '✓' : i + 1}
            </div>
            <span className={`text-sm ${state.step === i + 1 ? 'font-semibold text-gray-900' : 'text-gray-400'}`}>{label}</span>
            {i < STEPS.length - 1 && <div className="w-8 h-px bg-gray-300" />}
          </div>
        ))}
      </div>

      {state.step === 1 && <UploadStep state={state} update={update} />}
      {state.step === 2 && <MapStep state={state} update={update} />}
      {state.step === 3 && <PreviewStep state={state} update={update} />}
      {state.step === 4 && <ValidateStep state={state} update={update} />}
      {state.step === 5 && <ResultsStep state={state} update={update} />}
    </div>
  );
}
