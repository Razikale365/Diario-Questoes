import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Database,
  Loader2,
  ShieldCheck,
} from 'lucide-react';

import type { QuestionBankItem } from '../../types';
import {
  importLearningAggregates,
  type LearningImportReport,
} from '../api/learning';
import {
  buildLegacyAggregateBatchIdentity,
  buildLegacyAggregateImport,
} from '../domain/legacyAggregate';

interface LegacyEvidenceImportProps {
  targetSlug: string;
  questionBankItems: QuestionBankItem[];
  onImported: () => void;
  onError: (message: string) => void;
  showToast: (message: string) => void;
}

const errorText = (error: unknown) => (
  error instanceof Error ? error.message : 'Não foi possível importar o histórico agregado.'
);

export const LegacyEvidenceImport: React.FC<LegacyEvidenceImportProps> = ({
  targetSlug,
  questionBankItems,
  onImported,
  onError,
  showToast,
}) => {
  const aggregate = useMemo(
    () => buildLegacyAggregateImport(questionBankItems, targetSlug),
    [questionBankItems, targetSlug],
  );
  const batchIdentity = useMemo(
    () => buildLegacyAggregateBatchIdentity(targetSlug, aggregate.items),
    [aggregate.items, targetSlug],
  );
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<LearningImportReport | null>(null);

  useEffect(() => setReport(null), [targetSlug, batchIdentity]);

  const importAggregate = async () => {
    if (!aggregate.items.length) return;
    setBusy(true);
    try {
      const imported = await importLearningAggregates({
        targetSlug,
        batchId: batchIdentity,
        items: aggregate.items,
      }, batchIdentity);
      setReport(imported);
      onImported();
      showToast(`${imported.importedCount} lote(s) agregado(s) incorporado(s).`);
    } catch (error: unknown) {
      onError(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="border-t border-white/10 py-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-black uppercase tracking-widest text-gray-300">
        <Database className="h-4 w-4 text-violet-300" /> Histórico local agregado
        <span className="ml-auto text-[10px] text-gray-600">{aggregate.items.length} lote(s) elegível(is)</span>
      </summary>
      <div className="mt-3 flex flex-col gap-3 border-y border-white/10 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[#84cc16]" />
            <p className="text-xs font-black text-white">Somente contagens e metadados de tópico</p>
          </div>
          <p className="mt-1 text-[10px] font-semibold text-gray-500">
            {aggregate.items.reduce((total, item) => total + item.questionsDone, 0)} tentativa(s) · {aggregate.rejected.length} item(ns) ignorado(s) localmente
          </p>
          {report ? (
            <p className="mt-2 flex items-center gap-1.5 text-[10px] font-black text-[#bef264]">
              <CheckCircle2 className="h-3.5 w-3.5" /> {report.importedCount} importado(s) · {report.rejectedCount} sem correspondência
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={importAggregate}
          disabled={busy || aggregate.items.length === 0}
          className="flex h-9 shrink-0 items-center justify-center gap-1.5 rounded bg-violet-500 px-3 text-[10px] font-black uppercase text-white hover:bg-violet-400 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Database className="h-3.5 w-3.5" />}
          Importar evidência
        </button>
      </div>
      {report?.rejected.length ? (
        <ul className="mt-2 grid gap-1 text-[10px] font-semibold text-amber-200/80 md:grid-cols-2">
          {report.rejected.slice(0, 8).map((item) => <li key={`${item.sourceItemId}-${item.code}`}>{item.code}: {item.message}</li>)}
        </ul>
      ) : null}
    </details>
  );
};
