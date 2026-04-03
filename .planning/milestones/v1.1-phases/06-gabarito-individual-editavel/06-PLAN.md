# Phase 6: Gabarito Individual Editável — Plan

**Created:** 2026-03-31
**Phase:** 6
**Status:** In Progress
**Branch:** N/A

## Context Overview
**Goal:** Permitir edição manual do gabarito individual para cada questão, sem depender exclusivamente do bulk import.

## Implementation Steps

### 1. Update `updateQuestion` with correctAnswer logic
- Modify `App.tsx` where `updateQuestion` resides.
- If `correctAnswer` is updated manually, re-evaluate `isCorrect` based on the existing user `answer`.

### 2. Add UI for Manual Editing
- In the question block map inside `App.tsx`, modify the rendering of `{q.correctAnswer}`.
- Make it an interactive element — such as an input text field styled minimally, or a tiny button that toggles an input mode, allowing the user to type "A", "B", "C", "D", "E", "C", "E".
- If `q.correctAnswer` is empty, allow clicking a placeholder to add it.

### 3. Verify Constraints
- Edits shouldn't be allowed if `block.isLocked`.
- Inputs must cast to uppercase. Wait, `correctAnswer` input can be a tiny input next to the question number, just like `answer` but styled differently (perhaps green text).

## Dependencies
- None.

## Review Prompts
- Ensure the input handles letters correctly.
- Ensure changing the correct answer evaluates correction live.
