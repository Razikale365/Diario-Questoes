# Diário de Revisão LS

## What This Is

Aplicativo web para estudantes de concursos públicos que usam a plataforma LS (LFG). Permite registrar respostas de questões por atividade, rastrear erros e dúvidas, e gerar listas de revisão automáticas das questões que precisam ser refeitas.

## Core Value

O histórico de tarefas finalizadas deve ser um recurso vivo — consultável, corrigível e editável — não um arquivo somente leitura.

## Requirements

### Validated

- ✓ Importar tarefa da plataforma LS — existing
- ✓ Registrar respostas (A–E, C/E) + Certo/Errado/Dúvida — existing
- ✓ Importar gabarito por bloco — existing
- ✓ Travar/destravar blocos (lock) — existing
- ✓ Gerar revisão de erros/dúvidas — existing
- ✓ Histórico interativo e editável (Milestone v1.1) — implementado
- ✓ Reabrir tarefa finalizada para edição (Task Reopen) — implementado
- ✓ Múltiplas tarefas ativas simultâneas (Concurrent Tasks) — implementado
- ✓ Importar tarefa via colagem de texto (Paste Import) — implementado
- ✓ Toggle de visibilidade de estatísticas (Stats Visibility) — implementado
- ✓ Mesclagem de backups colados (Paste Backup Merge) — implementado
- ✓ **Analítica Hierárquica (Dúvida ✔/✖)** (v1.2) — implementado
- ✓ **Section Management com Lock Global** (v1.2) — implementado
- ✓ **Auditor-Level AI Revision Prompt** (v1.2) — implementado

### Backlog / Future

- [ ] Exportar tarefa como relatório/PDF
- [ ] Filtros e busca no histórico
- [ ] Estatísticas de performance por período

## Context

Codebase existente em React 19 + TypeScript + Vite + Tailwind CSS v4. Toda a lógica está em `src/App.tsx` (~1195 linhas). Persistência exclusivamente via `localStorage`. O mecanismo de lock por bloco (`isLocked`) já existe e funciona bem no caderno ativo — o objetivo é estender esse mesmo padrão para tarefas finalizadas, tornando o histórico interativo em vez de somente leitura.

Consulte `.planning/codebase/` para mapa completo da arquitetura atual.

## Constraints

- **Tech Stack**: React 19 + TypeScript + Tailwind CSS v4 — sem trocar de stack
- **Persistência**: localStorage apenas — sem backend por agora
- **Arquitetura**: Manter compatibilidade com dados existentes em `ls_tasks_v2` — não quebrar histórico salvo

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Estender UI do caderno ativo para tarefas finalizadas | Lock já existe; reusar padrão em vez de criar UI paralela | — Pending |
| Histórico permanece como tab separada | Não misturar tarefa ativa com histórico | — Pending |

## Current State

- **Shipped Version**: v1.2 (Analítica Hierárquica e Section Mgmt)
- **Current Milestone**: v1.3 — UX Refinement & Logical Organization (Recursive dragging, Smart auto-sections)

---

## Evolution History (Archived)

<details>
<summary>Milestone v1.1 — Histórico Editável</summary>
Focus: Tornar o histórico de tarefas finalizadas um recurso vivo.
- Multi-task support.
- Paste import/merge.
- Editable history details.
</details>

<details>
<summary>Milestone v1.2 — UX & Operational Robustness</summary>
Focus: Hierarchical analytics and section-level operations for Auditor-level exams.
- Doubts breakdown (✔/✖).
- Section Lock/Stats toggling.
- Strategic 'Auditor' AI prompts.
</details>

---

## Technical Decision Log
*Last updated: 2026-03-30 after initialization*
