import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchStrategyWorkbench,
  parseStrategyMapping,
  parseStrategyWorkbench,
  saveStrategyMapping,
} from './strategy';

const mapping = {
  id: 31,
  targetSlug: 'rfb_auditor',
  targetTopicId: 12,
  sourceItemId: 22,
  sourceTargetSlug: 'rfb_auditor',
  transferKind: 'target_specific',
  mappingStatus: 'approved',
  confidenceBp: 10000,
  primaryEligible: false,
  manualOverride: true,
  notes: 'Conferido manualmente.',
  version: 2,
};

const workbench = {
  targetSlug: 'rfb_auditor',
  packageStatus: {
    state: 'validated',
    rootId: 7,
    packageName: 'RFB Auditor 2026',
    packageId: '249654',
    downloadStatus: 'validated',
    manifestPath: 'C:\\Cursos\\RFB\\.study-os-download.json',
    expectedFileCount: 200,
    observedFileCount: 200,
    failedItemCount: 0,
    validated: true,
  },
  items: [{
    sourceItemId: 22,
    sourceId: 21,
    sourceTargetSlug: 'rfb_auditor',
    sourceKind: 'tec',
    sourceDisplayName: 'TEC RFB',
    trustTier: 8,
    edition: '2026',
    sourceVersion: 1,
    discipline: 'Direito Tributario',
    topicHint: 'Credito tributario',
    sourceOrder: 1,
    contentRole: 'question_practice',
    lessonId: null,
    materialId: null,
    externalUrl: 'https://www.tecconcursos.com.br/questoes/cadernos/1',
    externalId: 'tec-1',
    incidenceBp: 8800,
    banca: 'FGV',
    itemVersion: 1,
    resolutionState: 'approved',
    mappings: [{
      ...mapping,
      targetDiscipline: 'Direito Tributario',
      targetTopic: 'Credito tributario',
    }],
  }],
};

test('strategy parsers accept the joined workbench contract', () => {
  assert.deepEqual(parseStrategyMapping(mapping), mapping);
  assert.deepEqual(parseStrategyWorkbench(workbench), workbench);
});

test('strategy parsers reject unsafe or malformed mapping state', () => {
  assert.throws(
    () => parseStrategyWorkbench({
      ...workbench,
      items: [{ ...workbench.items[0], sourceKind: 'question_content' }],
    }),
    /strategy workbench/i,
  );
  assert.throws(
    () => parseStrategyMapping({ ...mapping, confidenceBp: 10001 }),
    /strategy mapping/i,
  );
  assert.throws(
    () => parseStrategyWorkbench({
      ...workbench,
      packageStatus: { ...workbench.packageStatus, validated: 'yes' },
    }),
    /strategy package/i,
  );
});

test('strategy workbench and optimistic save requests are exact', async (context) => {
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  context.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ input: String(input), init });
    return new Response(JSON.stringify(requests.length === 1 ? workbench : mapping), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  await fetchStrategyWorkbench('rfb_auditor');
  await saveStrategyMapping(22, {
    targetSlug: 'rfb_auditor',
    targetTopicId: 12,
    expectedVersion: 1,
    expectedSourceVersion: 1,
    sourceTrustTier: 6,
    mappingStatus: 'approved',
    transferKind: 'target_specific',
    confidenceBp: 10000,
    primaryEligible: false,
    notes: 'Conferido manualmente.',
  });

  assert.equal(requests[0]?.input, '/api/v1/strategy/workbench?targetSlug=rfb_auditor');
  assert.equal(requests[1]?.input, '/api/v1/strategy/source-items/22/mapping');
  assert.equal(requests[1]?.init?.method, 'PUT');
  assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), {
    targetSlug: 'rfb_auditor',
    targetTopicId: 12,
    expectedVersion: 1,
    expectedSourceVersion: 1,
    sourceTrustTier: 6,
    mappingStatus: 'approved',
    transferKind: 'target_specific',
    confidenceBp: 10000,
    primaryEligible: false,
    notes: 'Conferido manualmente.',
  });
});
