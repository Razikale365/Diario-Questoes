import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error('[Diário LS] Erro inesperado na interface', error);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-screen bg-[#1a1a1a] text-gray-100 flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-[#404040] bg-[#262626] p-6 text-center shadow-2xl">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10 text-red-400">
            <AlertTriangle className="h-7 w-7" />
          </div>
          <h1 className="text-xl font-black text-white">Algo travou na tela</h1>
          <p className="mt-3 text-sm leading-relaxed text-gray-400">
            Suas tarefas ficam salvas no navegador. Recarregar normalmente resolve sem apagar o diário.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-6 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#84cc16] px-5 py-3 font-bold text-white transition-colors hover:bg-[#65a30d]"
          >
            <RotateCcw className="h-5 w-5" />
            Recarregar app
          </button>
        </div>
      </div>
    );
  }
}
