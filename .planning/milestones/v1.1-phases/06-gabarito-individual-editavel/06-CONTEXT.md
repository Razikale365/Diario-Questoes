# Phase 6: Gabarito Individual Editável - Context

**Gathered:** 2026-03-31
**Status:** Ready for planning

<domain>
## Phase Boundary
Adicione a possibilidade de alterar o gabarito individual da questão manualmente ou setar também diretamente no card da questão, eliminando a dependência exclusiva da importação em lote.
</domain>

<decisions>
## Implementation Decisions
### The agent's Discretion
- Criar interação de clique ou botão para editar/setar gabarito de uma questão quando não há bloqueio (isLocked = false).
- A mudança do gabarito reavalia a correção (`isCorrect`) automaticamente em função da resposta atual (`q.answer`).
</decisions>

<code_context>
## Existing Code Insights
- A edição da resposta ocorre na aba Caderno e no Histórico em modo de edição. O gabarito é exibido via `q.correctAnswer`.
</code_context>

<specifics>
## Specific Ideas
- Substituir o span contendo o texto do gabarito por um campo de edição, ou permitir que o próprio span/botão abra a possibilidade de digitar o gabarito.
</specifics>

<deferred>
## Deferred Ideas
None
</deferred>
