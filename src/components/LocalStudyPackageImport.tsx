import React, { useState } from 'react';
import { ArchiveRestore, Loader2 } from 'lucide-react';

import type { StudyTask } from '../types';
import { saveQuestionSourceDocument } from '../storage/questionSourceDocuments';
import { parseLocalStudyPackageManifest } from '../utils/localStudyPackage';

interface LocalStudyPackageImportProps {
  onMergeTasks: (tasks: StudyTask[]) =>
    Promise<
      | { ok: true; added: number; duplicates: number }
      | { ok: false; message: string }
    >;
  showToast: (message: string) => void;
}

const PACKAGE_URL = '/private-import/sefaz-ce-final-week/package.json';

export const LocalStudyPackageImport: React.FC<LocalStudyPackageImportProps> = ({
  onMergeTasks,
  showToast,
}) => {
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  const importPackage = async () => {
    setIsImporting(true);
    setError('');
    setProgress('Lendo pacote privado...');

    try {
      const manifestResponse = await fetch(PACKAGE_URL, { cache: 'no-store' });
      if (!manifestResponse.ok) {
        throw new Error('Pacote privado não encontrado neste computador.');
      }
      const manifest = parseLocalStudyPackageManifest(await manifestResponse.json());
      const manifestUrl = new URL(PACKAGE_URL, window.location.href);

      for (const [index, document] of manifest.documents.entries()) {
        setProgress(`Guardando PDF ${index + 1} de ${manifest.documents.length}...`);
        const documentUrl = new URL(document.path, manifestUrl);
        const response = await fetch(documentUrl);
        if (!response.ok) {
          throw new Error(`Não foi possível ler ${document.fileName}.`);
        }
        const file = new File([await response.arrayBuffer()], document.fileName, {
          type: 'application/pdf',
        });
        const stored = await saveQuestionSourceDocument(file, document.pageCount);
        if (stored.id !== document.id) {
          throw new Error(`O PDF ${document.fileName} não corresponde ao pacote auditado.`);
        }
      }

      setProgress('Mesclando tarefas sem substituir o que já existe...');
      const result = await onMergeTasks(manifest.tasks);
      if (!result.ok) {
        throw new Error(result.message);
      }

      setProgress('');
      showToast(
        `${result.added} tarefa(s) adicionada(s); ${result.duplicates} já existiam; ${manifest.documents.length} PDFs preservados.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao importar o pacote privado.');
      setProgress('');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <section className="rounded-xl border border-[#84cc16]/25 bg-[#84cc16]/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-[#bef264]">
            Reta final SEFAZ CE
          </p>
          <p className="mt-1 max-w-2xl text-sm text-gray-300">
            Carrega os lotes escolhidos e as duas P1 integrais, com gabaritos definitivos e as
            páginas originais de tabelas e gráficos. O conteúdo continua privado neste computador.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void importPackage()}
          disabled={isImporting}
          className="flex min-h-[44px] items-center gap-2 rounded bg-[#84cc16] px-5 py-3 font-black text-black transition-colors hover:bg-[#bef264] disabled:cursor-wait disabled:opacity-60"
        >
          {isImporting ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArchiveRestore className="h-5 w-5" />}
          {isImporting ? 'Importando...' : 'Carregar semana final'}
        </button>
      </div>
      {progress && <p className="mt-3 text-xs font-bold text-[#d9f99d]">{progress}</p>}
      {error && <p role="alert" className="mt-3 text-xs font-bold text-red-300">{error}</p>}
    </section>
  );
};
