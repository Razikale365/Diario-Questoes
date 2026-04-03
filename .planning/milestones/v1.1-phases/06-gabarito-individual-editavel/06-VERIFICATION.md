# Phase 6 Verification

## Execution Status
- **Tasks Compiled:** Yes
- **Unit Tests Passed:** N/A
- **Manual Verification:** Tested via manual injection

## Acceptance Criteria
- [x] O usuário pode alterar o gabarito (A/B/C/D/E/C/E/ANULADA) em `correctAnswer` no Card.
- [x] Quando o gabarito é modificado, a correção da questão é reavaliada via `updateQuestion`.
- [x] A edição não é permitida se o bloco estiver bloqueado.

## Notes
A troca de `<span>` para `<input>` com `maxLength={7}` permite ao usuário editar diretamente.
O `maxLength={7}` foi escolhido para suportar gabaritos como "ERRADO", "CERTO" ou "ANULADA" que também podem ser traduzidos localmente no updateQuestion. A lógica `if (correctAns === 'ANULADA') newQ.isCorrect = true` foi adicionada para facilitar as marcações.

## Verdict
**STATUS: PASSED**
