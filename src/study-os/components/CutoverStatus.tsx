import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Database,
  Download,
  Loader2,
  RefreshCw,
  WifiOff,
} from 'lucide-react';

import { StudyOsApiError } from '../api/client';
import {
  fetchCutoverStatus,
  migrateBrowserState,
  updateActiveTarget,
  type CutoverStatus as CutoverStatusDto,
} from '../api/cutover';
import { fetchPlannerTargets, type PlannerTarget } from '../api/planner';
import {
  buildLegacyBrowserBundle,
  clearMigratedStudyOsKeys,
  hasLegacyBrowserMetadata,
  type LegacyBrowserBundlePayload,
} from '../migration/legacyBundle';


type ControllerState =
  | { kind: 'loading'; action: 'loading' | 'migrating' }
  | { kind: 'unavailable' }
  | { kind: 'error'; message: string }
  | {
      kind: 'ready';
      action: 'target' | null;
      status: CutoverStatusDto;
      targets: PlannerTarget[];
    };

export interface StudyOsCutoverController {
  state: ControllerState;
  status: CutoverStatusDto | null;
  targets: PlannerTarget[];
  activeTargetSlug: string;
  retry: () => void;
  setActiveTarget: (targetSlug: string) => Promise<void>;
}

const isAbort = (error: unknown): boolean => (
  error instanceof Error && error.name === 'AbortError'
);

const messageFor = (error: unknown): string => {
  if (error instanceof StudyOsApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'O corte para o banco local falhou.';
};

const isUnavailable = (error: unknown): boolean => (
  error instanceof TypeError && !(error instanceof StudyOsApiError)
);

export function useStudyOsCutover(): StudyOsCutoverController {
  const [state, setState] = useState<ControllerState>({
    kind: 'loading',
    action: 'loading',
  });
  const [revision, setRevision] = useState(0);
  const bundleRef = useRef<LegacyBrowserBundlePayload | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading', action: 'loading' });

    const load = async () => {
      try {
        let status = await fetchCutoverStatus(controller.signal);
        const completedBrowserMigration = status.migrations.some((migration) => (
          migration.schema === 'study-os.browser-migration.v1'
          && migration.state === 'completed'
        ));
        if (completedBrowserMigration) {
          clearMigratedStudyOsKeys(window.localStorage);
        } else if (hasLegacyBrowserMetadata(window.localStorage)) {
          setState({ kind: 'loading', action: 'migrating' });
          if (bundleRef.current === null) {
            bundleRef.current = buildLegacyBrowserBundle(
              window.localStorage,
              new Date(),
            );
          }
          const bundle = bundleRef.current;
          const result = await migrateBrowserState(
            bundle,
            `browser-cutover:${bundle.migrationId}:${bundle.exportedAt}`,
            controller.signal,
          );
          if (result.migration.state !== 'completed') {
            throw new Error('A migração do navegador não foi concluída.');
          }
          clearMigratedStudyOsKeys(window.localStorage);
          status = await fetchCutoverStatus(controller.signal);
        }
        const targets = await fetchPlannerTargets(controller.signal);
        setState({
          kind: 'ready',
          action: null,
          status,
          targets: targets.items,
        });
      } catch (error: unknown) {
        if (isAbort(error)) return;
        setState(isUnavailable(error)
          ? { kind: 'unavailable' }
          : { kind: 'error', message: messageFor(error) });
      }
    };

    void load();
    return () => controller.abort();
  }, [revision]);

  const retry = useCallback(() => setRevision((current) => current + 1), []);

  const setActiveTarget = useCallback(async (targetSlug: string) => {
    if (state.kind !== 'ready' || state.status.activeTarget === null) return;
    if (state.status.activeTarget.targetSlug === targetSlug) return;
    setState({ ...state, action: 'target' });
    try {
      const preference = await updateActiveTarget(
        targetSlug,
        state.status.activeTarget.version,
      );
      setState((current) => current.kind === 'ready'
        ? {
            ...current,
            action: null,
            status: { ...current.status, activeTarget: preference },
          }
        : current);
    } catch (error: unknown) {
      if (error instanceof StudyOsApiError && error.code === 'stale_active_target') {
        setRevision((current) => current + 1);
        return;
      }
      setState({ kind: 'error', message: messageFor(error) });
    }
  }, [state]);

  return {
    state,
    status: state.kind === 'ready' ? state.status : null,
    targets: state.kind === 'ready' ? state.targets : [],
    activeTargetSlug: state.kind === 'ready'
      ? state.status.activeTarget?.targetSlug || ''
      : '',
    retry,
    setActiveTarget,
  };
}

const EXPORT_COMMAND = [
  '.\\.venv-study-os\\Scripts\\python.exe',
  '-m study_os_service.cli export',
  '--output .\\data\\study-os\\exports\\study-os-portable.zip',
].join(' ');

export const CutoverStatus: React.FC<{
  controller: StudyOsCutoverController;
}> = ({ controller }) => {
  const [copied, setCopied] = useState(false);
  const { state } = controller;

  const copyExportCommand = async () => {
    try {
      await navigator.clipboard.writeText(EXPORT_COMMAND);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  if (state.kind === 'loading') {
    return (
      <section className="flex min-h-14 items-center gap-3 border-y border-white/10 bg-[#242424] px-4 py-3">
        <Loader2 className="h-4 w-4 animate-spin text-[#84cc16]" />
        <p className="text-sm font-bold text-gray-300">
          {state.action === 'migrating' ? 'Migrando metadados locais' : 'Conectando ao Study OS'}
        </p>
      </section>
    );
  }

  if (state.kind === 'unavailable') {
    return (
      <section className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-y border-red-400/20 bg-red-400/5 px-4 py-3">
        <div className="flex items-center gap-3">
          <WifiOff className="h-4 w-4 text-red-300" />
          <span className="text-sm font-bold text-red-100">Serviço local indisponível</span>
        </div>
        <RetryButton onClick={controller.retry} />
      </section>
    );
  }

  if (state.kind === 'error') {
    return (
      <section className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-y border-amber-400/20 bg-amber-400/5 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" />
          <span className="truncate text-sm font-bold text-amber-100">{state.message}</span>
        </div>
        <RetryButton onClick={controller.retry} />
      </section>
    );
  }

  const activeTarget = state.status.activeTarget;
  return (
    <section className="flex min-h-14 items-center justify-between gap-2 border-y border-white/10 bg-[#242424] px-3 py-2 sm:flex-wrap sm:gap-3 sm:px-4 sm:py-3">
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-wrap sm:gap-3">
        <div className="flex items-center gap-2 text-[#84cc16]">
          <CheckCircle2 className="h-4 w-4" />
          <span className="hidden text-xs font-black uppercase tracking-widest sm:inline">SQLite ativo</span>
        </div>
        <span className="hidden h-4 w-px bg-white/10 sm:block" />
        <label className="flex min-w-0 flex-1 items-center gap-2 text-xs font-bold text-gray-400 sm:flex-none">
          <Database className="hidden h-4 w-4 sm:block" />
          <span className="sr-only">Alvo ativo</span>
          <select
            value={activeTarget?.targetSlug || ''}
            onChange={(event) => void controller.setActiveTarget(event.target.value)}
            disabled={state.action !== null || activeTarget === null || state.targets.length === 0}
            className="h-8 min-w-0 w-full max-w-52 rounded border border-white/10 bg-[#181818] px-2 text-xs font-bold text-white outline-none focus:border-[#84cc16] disabled:opacity-50 sm:w-auto sm:max-w-64"
            aria-label="Alvo ativo do Study OS"
          >
            {state.targets.length === 0 && <option value="">Sem alvo configurado</option>}
            {state.targets.map((target) => (
              <option key={target.targetSlug} value={target.targetSlug}>
                {target.displayName}
              </option>
            ))}
          </select>
        </label>
        <span className="hidden text-[11px] font-bold text-gray-500 sm:inline">
          {state.status.migrations.length} migração(ões) · {state.status.legacyMappingCount} vínculos
        </span>
      </div>
      <button
        type="button"
        onClick={() => void copyExportCommand()}
        className="hidden h-9 w-9 items-center justify-center rounded border border-white/10 bg-white/5 text-gray-300 transition hover:bg-white/10 hover:text-white sm:flex"
        aria-label="Copiar comando de exportação portátil"
        title={copied ? 'Comando copiado' : 'Copiar comando de exportação portátil'}
      >
        {copied ? <Copy className="h-4 w-4 text-[#84cc16]" /> : <Download className="h-4 w-4" />}
      </button>
    </section>
  );
};

const RetryButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="flex h-9 w-9 items-center justify-center rounded border border-white/10 bg-white/5 text-gray-200 hover:bg-white/10"
    aria-label="Tentar conectar novamente"
    title="Tentar novamente"
  >
    <RefreshCw className="h-4 w-4" />
  </button>
);
