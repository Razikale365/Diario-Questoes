import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  Clock3,
  Loader2,
  RefreshCw,
} from 'lucide-react';

import {
  deferReviewItem,
  fetchReviewQueue,
  rebuildReviewQueue,
  type ReviewQueueItem,
} from '../api/learning';
import type { TargetTopic } from '../api/planner';
import {
  reviewQueueProof,
  reviewDueStatus,
  reviewReasonLabel,
  shiftPlannerDate,
} from '../domain/adaptiveView';

interface ReviewQueueProps {
  targetSlug: string;
  asOf: string;
  topics: TargetTopic[];
  refreshToken: number;
  onError: (message: string) => void;
  showToast: (message: string) => void;
}

const errorText = (error: unknown) => (
  error instanceof Error ? error.message : 'Não foi possível carregar a fila de revisão.'
);

const requestKey = (kind: string, targetSlug: string, suffix: string) => (
  `${kind}-${targetSlug}-${suffix}-${Date.now().toString(36)}`
);

const dueLabel = (date: string, asOf: string) => {
  const status = reviewDueStatus(date, asOf);
  if (status === 'overdue') return 'Atrasada';
  if (status === 'today') return 'Hoje';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${date}T00:00:00Z`))
    .replace('.', '');
};

export const ReviewQueue: React.FC<ReviewQueueProps> = ({
  targetSlug,
  asOf,
  topics,
  refreshToken,
  onError,
  showToast,
}) => {
  const [items, setItems] = useState<ReviewQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const topicById = useMemo(() => new Map(topics.map((topic) => [topic.id, topic])), [topics]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetchReviewQueue(targetSlug, asOf, signal);
      setItems(response.items);
    } catch (error: unknown) {
      if (!signal?.aborted) onError(errorText(error));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [asOf, onError, targetSlug]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, refreshToken]);

  const rebuild = async () => {
    setBusy('rebuild');
    try {
      const response = await rebuildReviewQueue(
        { targetSlug, asOf },
        requestKey('review-rebuild', targetSlug, asOf),
      );
      setItems(response.items);
      showToast(`${response.items.length} revisão(ões) curta(s) na fila.`);
    } catch (error: unknown) {
      onError(errorText(error));
    } finally {
      setBusy(null);
    }
  };

  const deferOneDay = async (item: ReviewQueueItem) => {
    setBusy(`defer-${item.id}`);
    try {
      const baseDate = item.dueDate > asOf ? item.dueDate : asOf;
      const saved = await deferReviewItem(
        item.id,
        { dueDate: shiftPlannerDate(baseDate, 1), expectedVersion: item.version },
        requestKey('review-defer', targetSlug, String(item.id)),
      );
      setItems((current) => current.map((entry) => entry.id === saved.id ? saved : entry));
      showToast('Revisão adiada por um dia.');
    } catch (error: unknown) {
      onError(errorText(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="border-t border-white/10 py-4" aria-labelledby="review-queue-title">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-amber-200" />
            <h3 id="review-queue-title" className="text-xs font-black uppercase tracking-widest text-gray-200">Revisões por evidência</h3>
          </div>
          <p className="mt-1 text-[10px] font-bold text-gray-500">{items.length} tópico(s) · sempre entre 5 e 10 questões</p>
        </div>
        <button
          type="button"
          onClick={rebuild}
          disabled={busy !== null || loading}
          className="flex h-9 items-center gap-1.5 rounded border border-white/10 bg-white/5 px-3 text-[10px] font-black uppercase text-gray-100 hover:bg-white/10 disabled:opacity-40"
        >
          {busy === 'rebuild' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Atualizar fila
        </button>
      </header>

      {loading ? (
        <div className="flex h-20 items-center justify-center gap-2 border-y border-white/10 text-xs font-bold text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando revisões...
        </div>
      ) : items.length ? (
        <div className="border-y border-white/10">
          {items.map((item) => {
            const topic = topicById.get(item.targetTopicId);
            const due = dueLabel(item.dueDate, asOf);
            return (
              <div key={item.id} className="grid min-h-16 grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-3 border-b border-white/5 px-2 py-2 last:border-b-0 sm:grid-cols-[90px_minmax(180px,0.8fr)_minmax(260px,1.2fr)_auto]">
                <div>
                  <p className={due === 'Atrasada' || due === 'Hoje' ? 'text-[10px] font-black uppercase text-amber-200' : 'text-[10px] font-black uppercase text-gray-500'}>{due}</p>
                  <p className="mt-1 text-[9px] font-bold text-gray-700">{item.state === 'deferred' ? 'Adiada' : 'Pendente'}</p>
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-black text-white">{topic?.discipline || `Tópico #${item.targetTopicId}`}</p>
                  <p className="truncate text-[10px] font-semibold text-gray-500">{topic?.topic || item.topicTargetSlug}</p>
                </div>
                <div className="col-span-2 min-w-0 sm:col-span-1">
                  <p className="text-[10px] font-black text-gray-300">{reviewReasonLabel(item.reason)}</p>
                  <p className="mt-1 text-[10px] font-semibold text-gray-600">{reviewQueueProof(item)}</p>
                </div>
                <button
                  type="button"
                  title="Adiar um dia"
                  aria-label={`Adiar revisão ${topic?.topic || item.targetTopicId} por um dia`}
                  onClick={() => deferOneDay(item)}
                  disabled={busy !== null}
                  className="flex h-8 w-8 items-center justify-center rounded border border-white/10 text-gray-300 hover:bg-white/10 disabled:opacity-40"
                >
                  {busy === `defer-${item.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock3 className="h-3.5 w-3.5" />}
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex h-20 items-center justify-center border-y border-dashed border-white/10 text-xs font-bold text-gray-600">Nenhuma revisão pendente</div>
      )}
    </section>
  );
};
