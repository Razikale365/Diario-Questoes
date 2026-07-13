import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Save,
  ShieldCheck,
} from 'lucide-react';

import { StudyOsApiError } from '../api/client';
import type { TargetTopic } from '../api/planner';
import {
  fetchStrategyWorkbench,
  saveStrategyMapping,
  type StrategyMappingStatus,
  type StrategyTransferKind,
  type StrategyWorkbench as StrategyWorkbenchResponse,
} from '../api/strategy';
import {
  buildStrategyWorkbenchRows,
  contentRoleLabel,
  packageStatusView,
  sourceKindLabel,
  type StrategyMappingDraft,
  type StrategyWorkbenchRow,
} from '../domain/strategyView';

interface StrategyWorkbenchProps {
  targetSlug: string;
  topics: TargetTopic[];
  onError: (message: string) => void;
  showToast: (message: string) => void;
}

const controlClass = 'h-8 min-w-0 rounded border border-white/10 bg-[#0d0d0d] px-2 text-[10px] font-bold text-white outline-none focus:border-[#84cc16]';

const resolutionLabel = {
  unresolved: 'Sem mapa',
  proposed: 'Proposto',
  approved: 'Aprovado',
  rejected: 'Rejeitado',
} as const;

const resolutionTone = {
  unresolved: 'text-amber-200',
  proposed: 'text-sky-200',
  approved: 'text-[#bef264]',
  rejected: 'text-red-200',
} as const;

const errorText = (error: unknown) => (
  error instanceof Error ? error.message : 'Não foi possível carregar as fontes.'
);

const draftMap = (workbench: StrategyWorkbenchResponse) => Object.fromEntries(
  buildStrategyWorkbenchRows(workbench).map((row) => [row.item.sourceItemId, row.draft]),
);

export const StrategyWorkbench: React.FC<StrategyWorkbenchProps> = ({
  targetSlug,
  topics,
  onError,
  showToast,
}) => {
  const [workbench, setWorkbench] = useState<StrategyWorkbenchResponse | null>(null);
  const [drafts, setDrafts] = useState<Record<number, StrategyMappingDraft>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [rowError, setRowError] = useState<Record<number, string>>({});

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetchStrategyWorkbench(targetSlug, signal);
      if (signal?.aborted) return;
      setWorkbench(response);
      setDrafts(draftMap(response));
    } catch (error: unknown) {
      if (!signal?.aborted) onError(errorText(error));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [onError, targetSlug]);

  useEffect(() => {
    const controller = new AbortController();
    setWorkbench(null);
    setRowError({});
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const rows = useMemo(
    () => workbench ? buildStrategyWorkbenchRows(workbench) : [],
    [workbench],
  );
  const packageView = workbench ? packageStatusView(workbench.packageStatus, targetSlug) : null;
  const topicGroups = useMemo(() => {
    const groups = new Map<string, TargetTopic[]>();
    topics.filter((topic) => topic.active).forEach((topic) => {
      groups.set(topic.discipline, [...(groups.get(topic.discipline) || []), topic]);
    });
    return [...groups.entries()];
  }, [topics]);

  const updateDraft = (sourceItemId: number, update: Partial<StrategyMappingDraft>) => {
    setDrafts((current) => ({
      ...current,
      [sourceItemId]: { ...current[sourceItemId], ...update },
    }));
    setRowError((current) => ({ ...current, [sourceItemId]: '' }));
  };

  const selectTopic = (row: StrategyWorkbenchRow, targetTopicId: number | null) => {
    const mapping = row.item.mappings.find((item) => item.targetTopicId === targetTopicId);
    updateDraft(row.item.sourceItemId, mapping ? {
      targetTopicId,
      expectedVersion: mapping.version,
      expectedSourceVersion: row.item.sourceVersion,
      sourceTrustTier: row.item.trustTier,
      mappingStatus: mapping.mappingStatus,
      transferKind: mapping.transferKind,
      confidenceBp: mapping.confidenceBp,
      primaryEligible: mapping.primaryEligible,
      notes: mapping.notes,
    } : {
      targetTopicId,
      expectedVersion: 0,
      expectedSourceVersion: row.item.sourceVersion,
      sourceTrustTier: row.item.trustTier,
      transferKind: row.item.sourceTargetSlug === targetSlug ? 'target_specific' : 'shared',
      primaryEligible: false,
    });
  };

  const save = async (row: StrategyWorkbenchRow) => {
    const draft = drafts[row.item.sourceItemId] || row.draft;
    if (!draft.targetTopicId) {
      setRowError((current) => ({ ...current, [row.item.sourceItemId]: 'Escolha um tópico do alvo.' }));
      return;
    }
    setSavingId(row.item.sourceItemId);
    try {
      await saveStrategyMapping(row.item.sourceItemId, {
        targetSlug,
        targetTopicId: draft.targetTopicId,
        expectedVersion: draft.expectedVersion,
        expectedSourceVersion: draft.expectedSourceVersion,
        sourceTrustTier: draft.sourceTrustTier,
        mappingStatus: draft.mappingStatus,
        transferKind: draft.transferKind,
        confidenceBp: draft.confidenceBp,
        primaryEligible: draft.primaryEligible,
        notes: draft.notes,
      });
      setRowError((current) => ({ ...current, [row.item.sourceItemId]: '' }));
      await load();
      showToast('Mapeamento de fonte salvo.');
    } catch (error: unknown) {
      if (error instanceof StudyOsApiError && error.status === 409) {
        setRowError((current) => ({
          ...current,
          [row.item.sourceItemId]: 'Conflito: a linha mudou. Dados recarregados.',
        }));
        await load();
      } else {
        setRowError((current) => ({ ...current, [row.item.sourceItemId]: errorText(error) }));
      }
    } finally {
      setSavingId(null);
    }
  };

  return (
    <section className="border-t border-white/10 pt-4" aria-labelledby="strategy-workbench-title">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-sky-300" />
            <h3 id="strategy-workbench-title" className="text-xs font-black uppercase tracking-widest text-gray-200">Fontes e correspondências</h3>
          </div>
          <p className="mt-1 text-[10px] font-bold text-gray-500">
            {rows.filter((row) => row.item.resolutionState === 'unresolved').length} sem mapa · {rows.filter((row) => row.item.resolutionState === 'approved').length} aprovadas
          </p>
        </div>
        {packageView ? (
          <div className={`flex min-w-0 items-start gap-2 text-right ${packageView.tone === 'success' ? 'text-[#bef264]' : 'text-amber-200'}`}>
            {packageView.tone === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
            <div className="min-w-0"><p className="text-[10px] font-black uppercase">{packageView.title}</p><p className="max-w-xl text-[10px] font-semibold text-gray-500">{packageView.detail}</p></div>
          </div>
        ) : null}
      </header>

      {loading ? (
        <div className="mt-3 flex h-24 items-center justify-center gap-2 border-y border-white/10 text-xs font-bold text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Carregando fontes...</div>
      ) : rows.length ? (
        <div className="mt-3 overflow-x-auto border-y border-white/10">
          <table className="w-full min-w-[1680px] border-collapse text-left text-[10px]">
            <thead className="bg-[#0d0d0d] font-black uppercase tracking-widest text-gray-500">
              <tr><th className="px-2 py-2">Estado</th><th>Fonte</th><th>Item</th><th>Tópico do alvo</th><th>Papel</th><th>Conf.</th><th>Transferência</th><th>Status</th><th>Primária</th><th>Notas</th><th>Alternativas</th><th className="px-2"></th></tr>
            </thead>
            <tbody>{rows.map((row) => {
              const draft = drafts[row.item.sourceItemId] || row.draft;
              const primaryCapable = Boolean(
                workbench?.packageStatus.validated
                && row.item.contentRole === 'primary_theory'
                && row.item.materialId
                && row.item.sourceTargetSlug === targetSlug,
              );
              const crossTarget = row.item.sourceTargetSlug !== targetSlug;
              return (
                <tr key={row.item.sourceItemId} className="border-t border-white/5 align-top">
                  <td className={`whitespace-nowrap px-2 py-2 font-black uppercase ${resolutionTone[row.item.resolutionState]}`}>{resolutionLabel[row.item.resolutionState]}</td>
                  <td className="max-w-44 py-2 pr-3"><p className="font-black text-white">{sourceKindLabel(row.item.sourceKind)}</p><p className="truncate text-gray-500">{row.item.sourceDisplayName}</p><div className="mt-1 flex items-center gap-1 text-gray-600"><span>confiança</span><input type="number" min={0} max={10} value={draft.sourceTrustTier} onChange={(event) => updateDraft(row.item.sourceItemId, { sourceTrustTier: Math.max(0, Math.min(10, Number(event.target.value))) })} className={`${controlClass} h-6 w-11 px-1`} /><span>/10 · {row.item.edition || 's/ edição'}</span></div></td>
                  <td className="max-w-64 py-2 pr-3"><p className="truncate font-black text-gray-200">{row.item.discipline}</p><p className="line-clamp-2 font-semibold text-gray-500">{row.item.topicHint}</p>{row.item.externalUrl ? <a href={row.item.externalUrl} target="study-os-source" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-sky-300 hover:text-sky-200">Abrir <ExternalLink className="h-3 w-3" /></a> : null}</td>
                  <td className="py-2 pr-2"><select value={draft.targetTopicId ?? ''} onChange={(event) => selectTopic(row, event.target.value ? Number(event.target.value) : null)} className={`${controlClass} w-72`}><option value="">Sem correspondência</option>{topicGroups.map(([discipline, items]) => <optgroup key={discipline} label={discipline}>{items.map((topic) => <option key={topic.id} value={topic.id}>{topic.topic}</option>)}</optgroup>)}</select></td>
                  <td className="max-w-36 py-2 pr-2 font-semibold text-gray-400">{contentRoleLabel(row.item.contentRole)}</td>
                  <td className="py-2 pr-2"><input type="number" min={0} max={100} value={Math.round(draft.confidenceBp / 100)} onChange={(event) => updateDraft(row.item.sourceItemId, { confidenceBp: Math.max(0, Math.min(10000, Number(event.target.value) * 100)) })} className={`${controlClass} w-16`} /></td>
                  <td className="py-2 pr-2"><select value={draft.transferKind} onChange={(event) => updateDraft(row.item.sourceItemId, { transferKind: event.target.value as StrategyTransferKind })} className={`${controlClass} w-32`}>{!crossTarget ? <option value="target_specific">Específica</option> : null}<option value="shared">Compartilhada</option><option value="partial">Parcial</option></select></td>
                  <td className="py-2 pr-2"><select value={draft.mappingStatus} onChange={(event) => { const mappingStatus = event.target.value as StrategyMappingStatus; updateDraft(row.item.sourceItemId, { mappingStatus, primaryEligible: mappingStatus === 'approved' ? draft.primaryEligible : false }); }} className={`${controlClass} w-24`}><option value="approved">Aprovado</option><option value="proposed">Proposto</option><option value="rejected">Rejeitado</option></select></td>
                  <td className="py-2 pr-2 text-center"><input type="checkbox" checked={draft.primaryEligible} disabled={!primaryCapable || draft.mappingStatus !== 'approved'} onChange={(event) => updateDraft(row.item.sourceItemId, { primaryEligible: event.target.checked })} className="h-4 w-4 accent-[#84cc16] disabled:opacity-30" aria-label={`Fonte primária ${row.item.topicHint}`} /></td>
                  <td className="py-2 pr-2"><input value={draft.notes} onChange={(event) => updateDraft(row.item.sourceItemId, { notes: event.target.value })} className={`${controlClass} w-64`} />{rowError[row.item.sourceItemId] ? <p className="mt-1 max-w-64 font-bold text-red-200">{rowError[row.item.sourceItemId]}</p> : null}</td>
                  <td className="max-w-64 py-2 pr-2">{row.item.mappings.length ? <div className="flex flex-wrap gap-1">{row.item.mappings.map((mapping) => <span key={mapping.id} className={`rounded px-1.5 py-1 font-bold ${mapping.id === row.activeMapping?.id ? 'bg-white/10 text-white' : 'bg-white/[0.03] text-gray-600'}`}>{mapping.targetDiscipline} · {mapping.targetTopic} · {Math.round(mapping.confidenceBp / 100)}%</span>)}</div> : <span className="text-amber-200/70">Sem candidato determinístico</span>}</td>
                  <td className="px-2 py-2"><button type="button" title="Salvar correspondência" aria-label={`Salvar fonte ${row.item.topicHint}`} onClick={() => void save(row)} disabled={savingId !== null} className="flex h-8 w-8 items-center justify-center rounded text-gray-300 hover:bg-white/10 disabled:opacity-40">{savingId === row.item.sourceItemId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}</button></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      ) : (
        <div className="mt-3 border-y border-dashed border-white/10 px-3 py-6 text-center">
          <AlertTriangle className="mx-auto h-5 w-5 text-amber-200" />
          <p className="mt-2 text-xs font-black text-gray-200">Nenhuma fonte registrada para este alvo</p>
          <p className="mt-1 text-[10px] font-semibold text-gray-500">{packageView?.detail}</p>
        </div>
      )}
    </section>
  );
};
