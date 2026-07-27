import type { StudyTask } from '../types';
import { parseStudyTaskBackup } from './taskBackup';

export interface LocalStudyPackageDocument {
  id: string;
  fileName: string;
  path: string;
  pageCount: number;
}

export interface LocalStudyPackageManifest {
  schema: 'diario-questoes.local-study-package';
  version: 1;
  label: string;
  tasks: StudyTask[];
  documents: LocalStudyPackageDocument[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isSafeRelativePath = (value: string) =>
  !value.startsWith('/') &&
  !value.startsWith('\\') &&
  !/^[a-z][a-z\d+.-]*:/i.test(value) &&
  !value.split(/[\\/]/).includes('..') &&
  /^[a-z\d._/\\-]+$/i.test(value);

const isDocument = (value: unknown): value is LocalStudyPackageDocument =>
  isObject(value) &&
  typeof value.id === 'string' &&
  /^pdf_[a-f\d]{64}$/.test(value.id) &&
  typeof value.fileName === 'string' &&
  value.fileName.trim().length > 0 &&
  typeof value.path === 'string' &&
  isSafeRelativePath(value.path) &&
  typeof value.pageCount === 'number' &&
  Number.isInteger(value.pageCount) &&
  value.pageCount > 0;

const invalidPackage = () => new Error('Pacote local inválido.');

export const parseLocalStudyPackageManifest = (value: unknown): LocalStudyPackageManifest => {
  if (
    !isObject(value) ||
    value.schema !== 'diario-questoes.local-study-package' ||
    value.version !== 1 ||
    typeof value.label !== 'string' ||
    value.label.trim().length === 0 ||
    !Array.isArray(value.tasks) ||
    value.tasks.length === 0 ||
    !Array.isArray(value.documents) ||
    !value.documents.every(isDocument)
  ) {
    throw invalidPackage();
  }

  const tasks = parseStudyTaskBackup(value.tasks);
  const documentIds = new Set(value.documents.map((document) => document.id));
  if (documentIds.size !== value.documents.length) {
    throw invalidPackage();
  }

  const missingSourceDocument = tasks.some((task) =>
    task.blocks.some((block) =>
      block.questions.some((question) =>
        question.sourcePage && !documentIds.has(question.sourcePage.documentId),
      ),
    ),
  );
  if (missingSourceDocument) {
    throw invalidPackage();
  }

  return {
    schema: 'diario-questoes.local-study-package',
    version: 1,
    label: value.label.trim(),
    tasks,
    documents: value.documents,
  };
};
