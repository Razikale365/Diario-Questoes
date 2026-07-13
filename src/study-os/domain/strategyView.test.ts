import assert from 'node:assert/strict';
import test from 'node:test';

import type { PlannerSourceChoice } from '../api/planner';
import type { StrategyWorkbench } from '../api/strategy';
import {
  buildSourceChoiceView,
  buildStrategyWorkbenchRows,
  packageStatusView,
  sourceKindLabel,
} from './strategyView';

const workbench: StrategyWorkbench = {
  targetSlug: 'bacen_economia_financas',
  packageStatus: {
    state: 'missing',
    rootId: null,
    packageName: null,
    packageId: null,
    downloadStatus: null,
    manifestPath: null,
    expectedFileCount: null,
    observedFileCount: null,
    failedItemCount: null,
    validated: false,
  },
  items: [
    {
      sourceItemId: 2,
      sourceId: 1,
      sourceTargetSlug: 'bacen_economia_financas',
      sourceKind: 'course',
      sourceDisplayName: 'Curso BACEN',
      trustTier: 10,
      edition: '2026',
      sourceVersion: 1,
      discipline: 'Macroeconomia',
      topicHint: 'Politica monetaria',
      sourceOrder: 1,
      contentRole: 'primary_theory',
      lessonId: 4,
      materialId: 5,
      externalUrl: null,
      externalId: null,
      incidenceBp: 0,
      banca: '',
      itemVersion: 1,
      resolutionState: 'approved',
      mappings: [{
        id: 9,
        targetSlug: 'bacen_economia_financas',
        targetTopicId: 11,
        sourceItemId: 2,
        sourceTargetSlug: 'bacen_economia_financas',
        transferKind: 'target_specific',
        mappingStatus: 'approved',
        confidenceBp: 9800,
        primaryEligible: true,
        manualOverride: true,
        notes: 'PDF original conferido.',
        version: 3,
        targetDiscipline: 'Macroeconomia',
        targetTopic: 'Politica monetaria',
      }],
    },
    {
      sourceItemId: 3,
      sourceId: 1,
      sourceTargetSlug: 'bacen_economia_financas',
      sourceKind: 'passo',
      sourceDisplayName: 'Passo BACEN',
      trustTier: 7,
      edition: '2026',
      sourceVersion: 1,
      discipline: 'Macroeconomia',
      topicHint: 'Multiplicador monetario',
      sourceOrder: 2,
      contentRole: 'review_support',
      lessonId: null,
      materialId: null,
      externalUrl: null,
      externalId: null,
      incidenceBp: 0,
      banca: '',
      itemVersion: 1,
      resolutionState: 'unresolved',
      mappings: [],
    },
  ],
};

const sourceEvidence = {
  algorithmVersion: 'm6-source-choice-v2',
  sourceId: 1,
  sourceItemId: 2,
  sourceKind: 'course' as const,
  displayName: 'Curso BACEN',
  contentRole: 'primary_theory' as const,
  sourceTargetSlug: 'bacen_economia_financas',
  targetFitBp: 10000,
  transferConfidenceBp: 9800,
  trustBp: 10000,
  freshnessBp: 10000,
  orderReadinessBp: 7500,
  strategyAlignmentBp: 10000,
  materialAvailabilityBp: 10000,
  lowTrustPenaltyBp: 0,
  mismatchPenaltyBp: 0,
  incidenceBp: 9000,
  banca: 'CEBRASPE',
  targetBanca: 'CEBRASPE',
  bancaFitBp: 10000,
  choiceContext: { coverageStatus: 'weak' },
  edition: '2026',
  lessonId: 4,
  materialId: 5,
  materialKind: 'original',
  externalUrl: null,
  externalId: null,
  mappingStatus: 'approved' as const,
  mappingConfidenceBp: 9800,
  primaryEligible: true,
  manualOverride: true,
  transferKind: 'target_specific' as const,
  stopReason: null,
  finalScore: 120000,
};

const sourceChoice: PlannerSourceChoice = {
  status: 'chosen',
  choiceRunId: 20,
  choiceRowId: 21,
  sourceItemId: 2,
  sourceKind: 'course',
  displayName: 'Curso BACEN',
  contentRole: 'primary_theory',
  sourceTargetSlug: 'bacen_economia_financas',
  lessonId: 4,
  materialId: 5,
  externalUrl: null,
  externalId: null,
  finalScore: 120000,
  evidence: sourceEvidence,
  alternatives: [
    {
      choiceRowId: 21,
      sourceItemId: 2,
      chosen: true,
      displacedByRowId: null,
      stopReason: null,
      finalScore: 120000,
      evidence: sourceEvidence,
    },
    {
      choiceRowId: 22,
      sourceItemId: 3,
      chosen: false,
      displacedByRowId: 21,
      stopReason: null,
      finalScore: 97000,
      evidence: {
        ...sourceEvidence,
        sourceItemId: 3,
        sourceKind: 'passo',
        displayName: 'Passo BACEN',
        contentRole: 'review_support',
        trustBp: 7000,
        strategyAlignmentBp: 5000,
        primaryEligible: false,
        finalScore: 97000,
      },
    },
  ],
};

test('strategy workbench puts unresolved rows first and preserves optimistic version', () => {
  const rows = buildStrategyWorkbenchRows(workbench);
  assert.equal(rows[0]?.item.sourceItemId, 3);
  assert.equal(rows[0]?.draft.expectedVersion, 0);
  assert.equal(rows[0]?.draft.targetTopicId, null);
  assert.equal(rows[1]?.draft.expectedVersion, 3);
  assert.equal(rows[1]?.draft.targetTopicId, 11);
  assert.equal(rows[1]?.activeMapping?.manualOverride, true);
});

test('missing BACEN package guidance stays target-specific', () => {
  const status = packageStatusView(workbench.packageStatus, workbench.targetSlug);
  assert.equal(status.tone, 'warning');
  assert.match(status.detail, /BACEN/i);
  assert.doesNotMatch(status.detail, /RFB|Receita/i);
});

test('source choice view explains the winner and displaced alternative', () => {
  const view = buildSourceChoiceView(sourceChoice);
  assert.equal(view.label, 'Curso');
  assert.match(view.reason, /alvo 100%/i);
  assert.equal(view.alternatives.length, 1);
  assert.equal(view.alternatives[0]?.label, 'Passo');
  assert.match(view.alternatives[0]?.decision, /deslocado/i);
  assert.equal(sourceKindLabel('andrety'), 'Andréty');
});
