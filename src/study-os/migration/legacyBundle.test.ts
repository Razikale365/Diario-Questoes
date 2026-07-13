import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLegacyBrowserBundle,
  clearMigratedStudyOsKeys,
  hasLegacyBrowserMetadata,
  MIGRATED_STUDY_OS_KEYS,
} from './legacyBundle';

class MemoryStorage {
  readonly values = new Map<string, string>();
  readonly removed: string[] = [];

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.removed.push(key);
    this.values.delete(key);
  }
}

const storageFixture = () => {
  const storage = new MemoryStorage();
  storage.setItem('study_os_target_v1', 'rfb_auditor');
  storage.setItem('study_os_phase_v1', 'pre_edital');
  storage.setItem('study_os_target_profiles_v1', [
    'slug | name | institution | role | organizer | phase | priority | cost_benefit | banca_fit | course | ls | active | vagas | notes | urls',
    'rfb_auditor | RFB Auditor | Receita Federal | Auditor-Fiscal | FGV | pre_edital | 88 | 9 | 8 | sim | sim | sim | 230 vagas | Edital 2022 | https://www.gov.br/receitafederal/',
  ].join('\n'));
  storage.setItem('study_os_coverage_table_v1', [
    'target | discipline | topic | status | edital_weight | incidence | material_hint | tier | material_source | notes',
    'rfb_auditor | Direito Tributario | Credito tributario | weak | 2 | 78 | Aula 02 | 1 | estrategia | Autoauditoria',
  ].join('\n'));
  storage.setItem('study_os_source_signals_v1', [
    'kind | target | discipline | topic | incidence | edital_weight | priority | trust | order | hint | text',
    'trilha_estrategica | rfb_auditor | Direito Tributario | Credito tributario | 70 | 2 | 80 | 7 | 3 | Passo 03 | Revisar o credito tributario',
    'tec_incidence | rfb_auditor | Contabilidade | Estoques | 91 | 1 | 90 | 8 | 1 | Caderno TEC | Alta incidencia',
  ].join('\n'));
  storage.setItem('ls_planner_tasks_v1', JSON.stringify([
    {
      id: 'ls-meta-46-task-29',
      number: 29,
      metaNumber: 46,
      discipline: 'Direito Tributario',
      format: 'Questoes',
      description: 'Credito tributario',
      spentMinutes: 45,
      estimatedMinutes: 60,
      performance: 70,
      status: 'completed',
      relevance: 5,
      scheduledDate: '2026-07-10',
      durationMinutes: 60,
      source: 'ls-meta-pdf',
      plannerSourceKind: 'ls',
      targetSlug: 'rfb_auditor',
      createdAt: '2026-07-10T12:00:00.000Z',
      updatedAt: '2026-07-10T13:00:00.000Z',
    },
    {
      id: 'generated-task-must-not-cross',
      number: 30,
      discipline: 'Direito Tributario',
      format: 'Teoria',
      description: 'Generated duplicate command',
      spentMinutes: 0,
      estimatedMinutes: 60,
      performance: null,
      status: 'pending',
      relevance: 5,
      durationMinutes: 60,
      source: 'generated',
      plannerSourceKind: 'generated_planner',
      targetSlug: 'rfb_auditor',
      createdAt: '2026-07-10T12:00:00.000Z',
      updatedAt: '2026-07-10T13:00:00.000Z',
    },
  ]));
  storage.setItem('ls_question_bank_v1', JSON.stringify([
    {
      id: 'question-1',
      fingerprint: 'fingerprint-1',
      statement: 'PROPRIETARY QUESTION MUST NOT CROSS',
      alternatives: [{ label: 'A', text: 'PROPRIETARY ALTERNATIVE' }],
      correctAnswer: 'A',
      sourceKind: 'estrategia',
      sourceName: 'Aula 02 - Credito tributario',
      targetSlug: 'rfb_auditor',
      discipline: 'Direito Tributario',
      lesson: 'Credito tributario',
      bank: 'FGV',
      tags: ['Meta 46'],
      favorite: true,
      hasDoubt: true,
      observations: 'PROPRIETARY COMMENT',
      attempts: [
        { answer: 'B', isCorrect: false, attemptedAt: '2026-07-10T12:00:00.000Z' },
        { answer: 'A', isCorrect: true, attemptedAt: '2026-07-11T12:00:00.000Z' },
      ],
      importedAt: '2026-07-09T12:00:00.000Z',
      updatedAt: '2026-07-11T12:00:00.000Z',
    },
  ]));
  storage.setItem('diario_unrelated_key', 'preserve me');
  return storage;
};

const forbiddenKeys = new Set([
  'statement',
  'question',
  'questiontext',
  'alternatives',
  'correctanswer',
  'answer',
  'gabarito',
  'observations',
  'comments',
  'html',
  'cookies',
  'credentials',
  'password',
  'token',
]);

const collectKeys = (value: unknown, found: string[] = []): string[] => {
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, found));
  } else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, nested]) => {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (forbiddenKeys.has(normalized)) found.push(key);
      collectKeys(nested, found);
    });
  }
  return found;
};

test('legacy bundle has a stable ID and converts safe planner metadata', () => {
  const storage = storageFixture();
  const first = buildLegacyBrowserBundle(storage, new Date('2026-07-13T18:00:00.000Z'));
  const later = buildLegacyBrowserBundle(storage, new Date('2026-07-14T18:00:00.000Z'));

  assert.equal(first.migrationId, later.migrationId);
  assert.equal(first.schema, 'study-os.browser-migration.v1');
  assert.equal(first.activeTargetSlug, 'rfb_auditor');
  assert.equal(first.targetProfiles.length, 1);
  assert.equal(first.coverageRows.length, 1);
  assert.equal(first.lsTasks.length, 1);
  assert.equal(first.lsTasks[0]?.legacyId, 'ls-meta-46-task-29');
  assert.deepEqual(first.lsTasks[0]?.metadata, {
    metaNumber: 46,
    source: 'ls-meta-pdf',
  });
  assert.deepEqual(
    first.sourceSignals.map((item) => item.sourceKind),
    ['trilha', 'tec'],
  );
});

test('legacy question evidence is aggregate-only at every depth', () => {
  const bundle = buildLegacyBrowserBundle(
    storageFixture(),
    new Date('2026-07-13T18:00:00.000Z'),
  );

  assert.deepEqual(bundle.learningItems, [{
    legacyId: 'question:fingerprint-1',
    targetSlug: 'rfb_auditor',
    targetTopicId: null,
    discipline: 'Direito Tributario',
    topic: 'Credito tributario',
    eventKind: 'questions',
    occurredAt: '2026-07-11T12:00:00.000Z',
    sourceDate: '2026-07-11',
    questionsDone: 2,
    correctCount: 1,
    wrongCount: 1,
    doubtCount: 1,
    favoriteCount: 1,
    sourceLabel: 'Aula 02 - Credito tributario',
    banca: 'FGV',
    tags: ['Meta 46'],
  }]);
  assert.deepEqual(collectKeys(bundle), []);
  const serialized = JSON.stringify(bundle);
  assert.doesNotMatch(serialized, /PROPRIETARY/i);
});

test('cleanup removes only duplicate Study OS ownership keys', () => {
  const storage = storageFixture();

  const removed = clearMigratedStudyOsKeys(storage);

  assert.deepEqual(removed, [...MIGRATED_STUDY_OS_KEYS]);
  assert.deepEqual(storage.removed, [...MIGRATED_STUDY_OS_KEYS]);
  assert.equal(storage.getItem('ls_planner_tasks_v1') !== null, true);
  assert.equal(storage.getItem('ls_question_bank_v1') !== null, true);
  assert.equal(storage.getItem('diario_unrelated_key'), 'preserve me');
});

test('legacy metadata detection ignores an empty browser', () => {
  const empty = new MemoryStorage();
  empty.setItem('ls_planner_tasks_v1', '[]');
  empty.setItem('ls_question_bank_v1', '[]');

  assert.equal(hasLegacyBrowserMetadata(empty), false);
  assert.equal(hasLegacyBrowserMetadata(storageFixture()), true);
});
