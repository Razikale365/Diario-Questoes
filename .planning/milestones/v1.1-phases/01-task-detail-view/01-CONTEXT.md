# Phase 1: Task Detail View - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Implementar uma view de detalhe para tarefas do histórico: o usuário clica em qualquer linha da tabela do histórico e vê a tarefa completa (todos os blocos, questões, respostas, gabarito) com capacidade de edição plena using the existing lock mechanism. A view substitui a lista do histórico inline na mesma tab, com um botão "← Voltar ao Histórico" para retornar.

</domain>

<decisions>
## Implementation Decisions

### Navegação & Layout
- Clicar em qualquer lugar da linha da tabela (row inteira clicável) abre a tarefa
- A view de detalhe substitui a lista do histórico na mesma área (inline, not modal)
- Botão "← Voltar ao Histórico" no topo da view de detalhe para retornar

### Acesso a Edição
- Todos os blocos ficam locked (isLocked: true) por padrão ao abrir tarefa finalizada do histórico
- Sem botão "Finalizar Tarefa" na view de detalhe — tarefa permanece `completed`
- Status da tarefa não muda ao editar pelo histórico — permanece `completed`

### Arquitetura de Estado
- Novo estado `viewingTaskId: string | null` separado de `activeTaskId`
- Handlers refatorados para usar `viewingTaskId ?? activeTaskId` como targetId — sem duplicação
- JSX de blocos/questões reutilizado (não duplicado) — controlado por qual task object é passado

### the agent's Discretion
- Import do ícone `ArrowLeft` do lucide-react para o botão de voltar
- Stop propagation no botão de delete na tabela do histórico para evitar conflito com row click
- Handler `openHistoryTask(taskId)` que trava todos os blocos da tarefa ao abrir

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- Bloco completo de rendering de questões/blocos em `src/App.tsx` linhas ~815–904 (será reutilizado para a view de detalhe)
- Modais existentes: `gabaritoModal`, `blockEditModal` (reutilizáveis sem modificação)
- Task info header com edit form (`isEditingTask`, `editForm`, `startEditingTask`, `saveTaskEdits`) — reutilizável
- Handler `showToast` para feedback ao usuário

### Established Patterns
- Estado de navegação por `null` check: `activeTaskId !== null` → mostra caderno ativo; pattern a replicar com `viewingTaskId !== null`
- Todos os `setTasks` usam `prev.map(t => t.id === targetId ? {...t, changes} : t)` — padrão imutável
- useMemo para derivar `activeTask` a partir de `tasks` array — mesma abordagem para `viewingTask`

### Integration Points
- Tab `historico`: linhas ~988–1057 do App.tsx — onde a view de detalhe será injetada condicionalmente
- Tabela do histórico: rows precisam de `onClick` e `cursor-pointer`
- Estado no topo do componente App (~linha 228) — onde `viewingTaskId` será adicionado

</code_context>

<specifics>
## Specific Ideas

- O botão de delete na tabela do histórico deve usar `e.stopPropagation()` para não ativar o click na row
- Ao abrir uma tarefa do histórico, todos os blocos devem ser setados como `isLocked: true` (lógica no handler)

</specifics>

<deferred>
## Deferred Ideas

- Reabrir tarefa finalizada como "Em Andamento" no caderno ativo — Out of scope nesta fase
- Filtros e busca no histórico — backlog futuro

</deferred>
