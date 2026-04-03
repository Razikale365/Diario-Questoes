---
wave: 1
depends_on: []
files_modified:
  - "src/App.tsx"
  - "src/hooks/useTasks.ts"
  - "src/components/TaskHeader.tsx"
autonomous: true
---

<objective>
Implementar a funcionalidade de reabrir uma tarefa finalizada do histórico para que ela volte a ser a tarefa ativa no "Caderno".
</objective>

<task>
<read_first>
- "src/App.tsx"
- "src/hooks/useTasks.ts"
- "src/components/TaskHeader.tsx"
</read_first>
<action>
1. Adicionar função `reopenTask(taskId: string)` no hook `useTasks.ts`. 
   - Esta função deve:
     - Encontrar a tarefa pelo ID.
     - Atualizar o status para 'in_progress'.
     - Desbloquear todos os blocos (`isLocked: false`).
     - Definir `activeTaskId` como o ID da tarefa.
2. Atualizar o componente `TaskHeader.tsx` para exibir um botão "Reabrir Tarefa" quando a tarefa estiver no histórico (exibindo data).
   - O botão deve chamar uma nova prop `onReopen`.
3. No `App.tsx`:
   - Passar a função `reopenTask` do hook para o `TaskHeader` dentro da view do histórico.
   - Após reabrir, fechar a visualização do histórico (`setViewingTaskId(null)`) e mudar a aba para 'caderno' (`setActiveTab('caderno')`).
</action>
<acceptance_criteria>
- Ao abrir uma tarefa no histórico, o botão "Reabrir Tarefa" (ícone Play ou Undo) é visível no header.
- Ao clicar no botão, a tarefa desaparece do histórico detalhado, a aba muda para "Caderno" e a tarefa aparece como a ativa.
- Os blocos da tarefa reaberta estão desbloqueados para edição.
- O estado é persistido no localStorage.
</acceptance_criteria>
</task>
