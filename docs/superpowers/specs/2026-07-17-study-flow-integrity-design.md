# Study Flow Integrity — Design Specification

**Date:** 2026-07-17  
**Status:** Approved for implementation by the user's explicit instruction to continue resolving the reported problems.  
**Scope:** Planner task execution, IA Hoje, Sprint Calendar, question attachment, and Tasks table quality-of-life.

## Problem

The same study task is currently represented in four partially independent state paths: browser Planner tasks, browser StudyTask notebooks, service-owned source-plan tasks, and service-owned sprint day/calendar actions. This causes observable contradictions:

- a task completed from the Planner can remain pending in IA Hoje and return after auto-organize;
- IA Hoje and Calendar can display different projections of the same task;
- the ordinary result dialog cannot record the LS evidence needed by calibration;
- a task opened before questions are imported remains linked to an empty notebook;
- importing a PDF/text batch into an existing task is not available from the task surface;
- the Tasks table has fixed columns and fixed number ordering.

## Product Outcome

Completing a task is one durable command, regardless of which screen starts it. The command records when and how the work was performed, projects the result to every planning surface in one transaction, and emits a frontend refresh signal. Completed work stays visible as positive feedback but never re-enters the pending queue. Questions can be attached later to the same task, immediately enabling Questions and Cards. The Tasks table becomes configurable without turning the primary workflow into a dense administrative surface.

## Canonical Execution Record

Add an append-only `task_executions` record owned by the local service. Each accepted result stores:

- target and source-plan task identity;
- optional sprint action and calendar item identities;
- outcome: `started`, `completed`, `failed`, or `skipped`;
- `performedOn` (local calendar date) and `recordedAt` (UTC timestamp);
- total task minutes and exercise-only minutes;
- total, correct, wrong, and doubt question counts;
- derived performance when correct/wrong evidence exists, otherwise an explicitly supplied percentage or no percentage;
- energy after execution and optional notes;
- idempotency key and immutable payload hash.

Validation rules:

- `performedOn` cannot be in the future;
- all counts and minutes are non-negative integers;
- exercise minutes cannot exceed task minutes;
- correct + wrong cannot exceed total questions;
- doubt count cannot exceed total questions;
- when correct + wrong is greater than zero, performance is derived and cannot contradict the counts;
- idempotency replay returns the existing execution; reusing the key with another payload is a conflict.

## Transactional Projection

One service transaction must:

1. insert or replay the execution;
2. update the source-plan task execution state and evidence using `performedOn`;
3. update a linked sprint action when one exists;
4. complete/fail the linked calendar item and remove completion from executable assignments;
5. recover or close backlog state consistently;
6. emit the existing learning/calibration evidence exactly once.

The persisted execution is the audit source. Source task, action, calendar, backlog, and evidence are projections and must not diverge after a successful command. A rollback leaves all projections unchanged.

## Reorganization Invariants

- Completed work is terminal historical evidence, not pending capacity. Failed and skipped attempts remain auditable and may be explicitly rescheduled, but never duplicate inside the same applied day/run.
- Completed tasks remain visible in Calendar and task history with a completion treatment and their original scheduled/performed dates.
- Auto-organize reflows only pending, unstarted work from today through the active cycle end.
- Started/manual/pinned assignments remain stable unless the user explicitly moves them.
- Auto-organize must read the durable service state after completion and must not race an asynchronous browser import.
- IA Hoje is the daily projection of the applied Calendar head; it must not keep an older independently generated action for a reconciled source task.

## Result Experience

Both Planner and IA Hoje use the same LS-style result fields:

- date performed, default today with quick “Ontem” choice;
- task time and exercise time;
- total questions, correct, wrong, and doubts;
- performance shown as a derived read-only value when counts are supplied;
- energy after and optional notes;
- outcome controls for started, completed, failed, and skipped.

The dialog validates fields inline, preserves the saved result locally even if a subsequent recalculation fails, and clearly reports “resultado salvo; recálculo pendente” instead of discarding evidence.

## Question Attachment

Use the existing PDF objective-question parser and question-bank merge rules in a shared in-task import modal. Entry points appear in the task detail/execution surface and on an activity block. The flow is:

1. choose PDF or paste text;
2. preview parsed questions, warnings, answer keys, duplicates, and destination;
3. attach to a new section, new block, or selected existing block;
4. atomically persist the StudyTask and question bank;
5. refresh the currently open task and enable Questions/Cards immediately.

Imports are idempotent. Exact duplicates do not create a second question. A richer parsed question may fill an empty placeholder but must not overwrite user answers, attempts, notes, favorites, doubt flags, or a conflicting manual correction.

## Tasks Table

Keep the current visual hierarchy and add progressive disclosure:

- header click cycles ascending, descending, and unsorted;
- column configuration supports drag reorder, show/hide, and restore defaults;
- Actions is fixed, always visible, and remains the last column;
- preferences are versioned and stored locally per browser;
- invalid/old preferences safely migrate to defaults;
- sorting is stable, treats missing values last, and uses task number/id as a deterministic tie-breaker;
- search and quick filters continue to combine with AND.

## Refresh Contract

After any execution or question attachment, emit a single app-level `study-os:data-changed` event containing target, affected task, and resource kinds. IA Hoje, Calendar, Planner task list, and the open task view invalidate only the resources they own. Network failures do not roll back an already accepted execution.

## Verification

Required automated coverage:

- migration preserves schema v1-v12 data and creates the execution invariants;
- backdated result, future-date rejection, count/time validation, idempotency, and rollback;
- complete then auto-organize never requeues the task;
- calendar apply then IA Hoje parity;
- local Planner completion of an LS-history task is authoritative;
- refresh failure retains the saved result in the UI;
- result parser derives performance and accepts incomplete typing only until submit;
- late import attaches to the existing task, deduplicates, and enables Questions/Cards;
- table preference migration, stable sort, reorder, hide, fixed Actions, and restore defaults;
- full Python/frontend regression, TypeScript, production build, and desktop/mobile browser acceptance.

## Out of Scope

- downloading the Estratégia package;
- scraping proprietary question content from LS/TEC;
- replacing the Calendar screen or hiding completed work;
- automatic cloud synchronization of browser-only question content.
