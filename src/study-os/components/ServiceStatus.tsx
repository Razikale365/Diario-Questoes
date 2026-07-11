import React, { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, WifiOff } from 'lucide-react';

import { fetchStudyOsHealth, isStudyOsHealthOperational, type StudyOsHealth } from '../api/health';

type ServiceState =
  | { kind: 'starting' }
  | { kind: 'connected'; health: StudyOsHealth }
  | { kind: 'unavailable' };

export const ServiceStatus: React.FC = () => {
  const [state, setState] = useState<ServiceState>({ kind: 'starting' });

  useEffect(() => {
    const controller = new AbortController();
    fetchStudyOsHealth(controller.signal)
      .then((health) => setState(
        isStudyOsHealthOperational(health)
          ? { kind: 'connected', health }
          : { kind: 'unavailable' },
      ))
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === 'AbortError') return;
        setState({ kind: 'unavailable' });
      });
    return () => controller.abort();
  }, []);

  if (state.kind === 'connected') {
    return (
      <div role="status" className="flex h-9 min-w-[126px] items-center justify-center gap-2 rounded border border-[#84cc16]/35 bg-[#84cc16]/10 px-3 text-[10px] font-black uppercase tracking-widest text-[#d9f99d]">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Conectado</span>
        <span className="text-[#84cc16]">v{state.health.schemaVersion}</span>
      </div>
    );
  }

  if (state.kind === 'unavailable') {
    return (
      <div role="status" className="flex h-9 min-w-[126px] items-center justify-center gap-2 rounded border border-red-400/30 bg-red-400/10 px-3 text-[10px] font-black uppercase tracking-widest text-red-200" title="O serviço local do Study OS não respondeu">
        <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Indisponível</span>
      </div>
    );
  }

  return (
    <div role="status" className="flex h-9 min-w-[126px] items-center justify-center gap-2 rounded border border-white/10 bg-black/20 px-3 text-[10px] font-black uppercase tracking-widest text-gray-400">
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      <span>Iniciando</span>
    </div>
  );
};
