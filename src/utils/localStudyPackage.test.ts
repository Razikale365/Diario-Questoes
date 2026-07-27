import assert from 'node:assert/strict';
import test from 'node:test';

import { parseLocalStudyPackageManifest } from './localStudyPackage';

const task = {
  id: 'final-week:batch-1',
  date: '2026-07-25T00:00:00.000Z',
  planejamento: 'Reta Final SEFAZ CE',
  meta: '',
  tarefa: 'P1-26',
  assunto: 'P1 cirúrgica',
  discipline: 'Simulados',
  bank: 'FCC',
  blocks: [],
  status: 'in_progress',
};

test('parses a private local package with safe relative PDF references', () => {
  const parsed = parseLocalStudyPackageManifest({
    schema: 'diario-questoes.local-study-package',
    version: 1,
    label: 'Reta Final SEFAZ CE 2026',
    tasks: [task],
    documents: [
      {
        id: `pdf_${'a'.repeat(64)}`,
        fileName: 'rodada-05-p1.pdf',
        path: 'pdfs/rodada-05-p1.pdf',
        pageCount: 35,
      },
    ],
  });

  assert.equal(parsed.label, 'Reta Final SEFAZ CE 2026');
  assert.equal(parsed.tasks.length, 1);
  assert.equal(parsed.documents[0].path, 'pdfs/rodada-05-p1.pdf');
});

test('rejects traversal, remote URLs, malformed document ids and empty tasks', () => {
  const base = {
    schema: 'diario-questoes.local-study-package',
    version: 1,
    label: 'Pacote privado',
    tasks: [task],
    documents: [
      {
        id: `pdf_${'b'.repeat(64)}`,
        fileName: 'p1.pdf',
        path: 'pdfs/p1.pdf',
        pageCount: 30,
      },
    ],
  };

  for (const mutation of [
    { tasks: [] },
    { documents: [{ ...base.documents[0], path: '../p1.pdf' }] },
    { documents: [{ ...base.documents[0], path: 'https://example.com/p1.pdf' }] },
    { documents: [{ ...base.documents[0], id: 'pdf_invalido' }] },
  ]) {
    assert.throws(
      () => parseLocalStudyPackageManifest({ ...base, ...mutation }),
      /Pacote local inválido/,
    );
  }
});
