# Question Answer Reveal Design

## Goal

Let the student answer before seeing the gabarito in both Cards and horizontal Questions, while retaining a fast way to reveal one answer or every answer in the current block.

## Scope

- Cards hide the answer key by default, even when `correctAnswer` is available.
- The existing gabarito/book icon beside a card question reveals or hides that question's answer key.
- The existing block-level gabarito icon in horizontal Questions reveals or hides all answer keys in that block.
- Each horizontal question receives the same individual reveal/hide icon.
- Revealing a question after an alternative has been selected computes and persists `isCorrect` from `correctAnswer`.
- Revealing a question without a selected alternative exposes the key without creating a result.
- Hiding only removes answer-key and correctness feedback from the current view. It never clears `answer`, `isCorrect`, statistics, doubts, favorites, or observations.

## Interaction Model

Answer-key visibility is local UI state, not durable task data.

```text
question starts hidden
  -> student selects alternative
  -> individual reveal: show key and persisted correct/incorrect result
  -> individual hide: conceal key and feedback, preserve recorded result

block reveal: apply the same reveal operation to every question with a key
block hide: conceal every answer key and feedback, preserve recorded results
```

Cards use one `Set<number>` of revealed question identities for the active task. Horizontal Questions use the same local model per `ActivityBlockCard`.

The shared Book/gabarito symbol is reused, but its meaning is mode-specific:

- In execution (`questoes`) mode, the toolbar icon reveals or hides every keyed question in the current block. It updates local reveal state only.
- In execution mode, each question has the same icon to reveal or hide only that question.
- `block.showGabarito` remains the persisted manual-key/editor preference used by the dedicated gabarito flow. It must not pre-reveal answers in execution mode.

## Edge Cases

- No gabarito: the icon is disabled or omitted; no result can be auto-graded.
- Locked block: answer selection and result persistence remain disabled. Existing revealed state can still be displayed read-only.
- Changed answer after revealing: conceal the stale result feedback until the student reveals again; selecting a new alternative clears persisted `isCorrect` so statistics cannot claim an outdated result.
- `ANULADA`: reveal shows the annulment; it does not mark the student answer right or wrong automatically.
- Imported/manual gabarito editing remains available in the dedicated gabarito view. This feature does not change how answer keys are imported or edited.

## Verification

- Unit tests prove hidden-by-default behavior, individual reveal, block reveal, hide-without-data-loss, changed-answer reset, missing key, and annulled key behavior.
- Existing question deck and activity block tests continue passing.
- Desktop and 390 px checks confirm the icon controls fit without horizontal page overflow.
