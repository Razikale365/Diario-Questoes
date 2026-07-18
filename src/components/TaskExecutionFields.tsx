import React, { useMemo } from 'react';

import {
  parseTaskExecutionDraft,
  type TaskExecutionDraft,
} from '../utils/taskResultDraft';

interface TaskExecutionFieldsProps {
  draft: TaskExecutionDraft;
  errors?: Partial<Record<keyof TaskExecutionDraft, string>>;
  onChange: (next: TaskExecutionDraft) => void;
}

const localIsoDate = (date = new Date()) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};

const yesterday = () => {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return localIsoDate(date);
};

const NumericField: React.FC<{
  label: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}> = ({ label, value, error, onChange }) => (
  <label className="grid min-w-0 gap-1 text-[9px] font-black uppercase tracking-[0.16em] text-gray-400">
    {label}
    <input
      type="text"
      inputMode="numeric"
      value={value}
      aria-invalid={Boolean(error)}
      onChange={(event) => onChange(event.target.value)}
      className={`h-10 min-w-0 border bg-[#111513] px-3 text-sm font-black text-white outline-none focus:border-[#84cc16] ${error ? 'border-rose-400' : 'border-white/10'}`}
    />
    {error ? <span role="alert" className="normal-case tracking-normal text-rose-200">{error}</span> : null}
  </label>
);

export const TaskExecutionFields: React.FC<TaskExecutionFieldsProps> = ({ draft, errors, onChange }) => {
  const parsed = useMemo(() => parseTaskExecutionDraft(draft), [draft]);
  const performance = parsed.ok && parsed.value.performanceBp !== null
    ? `${(parsed.value.performanceBp / 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
    : 'Sem questões respondidas';
  const fieldErrors = errors ?? (parsed.ok ? {} : parsed.errors);
  const update = (updates: Partial<TaskExecutionDraft>) => onChange({ ...draft, ...updates });

  return (
    <fieldset className="border border-white/10 bg-[#171b18] p-3 sm:p-4">
      <legend className="px-1 text-[9px] font-black uppercase tracking-[0.2em] text-[#bef264]">Recibo de execução</legend>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="grid min-w-0 gap-1 text-[9px] font-black uppercase tracking-[0.16em] text-gray-400">
          Data realizada
          <input
            type="date"
            value={draft.performedOn}
            max={localIsoDate()}
            aria-invalid={Boolean(fieldErrors.performedOn)}
            onChange={(event) => update({ performedOn: event.target.value })}
            className={`h-10 min-w-0 border bg-[#111513] px-3 text-sm font-black text-white outline-none focus:border-[#84cc16] ${fieldErrors.performedOn ? 'border-rose-400' : 'border-white/10'}`}
          />
          {fieldErrors.performedOn ? <span role="alert" className="normal-case tracking-normal text-rose-200">{fieldErrors.performedOn}</span> : null}
        </label>
        <div className="flex items-end">
          <button type="button" onClick={() => update({ performedOn: yesterday() })} className="h-10 w-full border border-sky-300/25 bg-sky-300/10 px-3 text-[10px] font-black uppercase tracking-wide text-sky-100 hover:bg-sky-300/20" title="Usar a data de ontem">
            Ontem
          </button>
        </div>
        <NumericField label="Tempo total" value={draft.taskMinutes} error={fieldErrors.taskMinutes} onChange={(taskMinutes) => update({ taskMinutes })} />
        <NumericField label="Tempo de exercícios" value={draft.exerciseMinutes} error={fieldErrors.exerciseMinutes} onChange={(exerciseMinutes) => update({ exerciseMinutes })} />
        <NumericField label="Questões" value={draft.questionsTotal} error={fieldErrors.questionsTotal} onChange={(questionsTotal) => update({ questionsTotal })} />
        <NumericField label="Certas" value={draft.correctCount} error={fieldErrors.correctCount} onChange={(correctCount) => update({ correctCount })} />
        <NumericField label="Erradas" value={draft.wrongCount} error={fieldErrors.wrongCount} onChange={(wrongCount) => update({ wrongCount })} />
        <NumericField label="Dúvidas" value={draft.doubtCount} error={fieldErrors.doubtCount} onChange={(doubtCount) => update({ doubtCount })} />
      </div>

      <div className="mt-3 grid gap-3 border-t border-white/[0.07] pt-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <label className="grid gap-1 text-[9px] font-black uppercase tracking-[0.16em] text-gray-400">
          Observações
          <textarea value={draft.notes} onChange={(event) => update({ notes: event.target.value })} rows={2} className="resize-y border border-white/10 bg-[#111513] px-3 py-2 text-sm font-semibold text-white outline-none focus:border-[#84cc16]" />
        </label>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid min-w-0 flex-1 gap-1 text-[9px] font-black uppercase tracking-[0.16em] text-gray-400">
            Desempenho derivado
            <input readOnly value={performance} title="Calculado automaticamente a partir de certas e erradas" className="h-10 min-w-0 w-full border border-[#84cc16]/20 bg-[#84cc16]/10 px-3 text-sm font-black text-[#d9f99d] outline-none sm:w-56" />
          </label>
          <div className="grid gap-1">
            <span className="text-[9px] font-black uppercase tracking-[0.16em] text-gray-400">Energia depois</span>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((level) => <button key={level} type="button" aria-pressed={draft.energyAfter === level} title={`Energia ${level} de 5`} onClick={() => update({ energyAfter: level })} className={`grid h-10 w-10 place-items-center border text-xs font-black ${draft.energyAfter === level ? 'border-[#84cc16] bg-[#84cc16] text-black' : 'border-white/10 bg-white/[0.03] text-gray-300 hover:bg-white/10'}`}>{level}</button>)}
            </div>
            {fieldErrors.energyAfter ? <span role="alert" className="text-xs normal-case tracking-normal text-rose-200">{fieldErrors.energyAfter}</span> : null}
          </div>
        </div>
      </div>
    </fieldset>
  );
};
