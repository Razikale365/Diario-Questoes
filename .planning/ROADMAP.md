# ROADMAP.md — Diário de Revisão LS

## Completed Milestones

- [Milestone v1.1 — Histórico Editável](file:///.planning/milestones/v1.1-ROADMAP.md) (Complete)
- [Milestone v1.2 — UX & Operational Robustness](file:///.planning/milestones/v1.2-ROADMAP.md) (Complete)
- [Milestone v1.3 — UX Refinement & Logical Organization](file:///c:/Users/JP/Desktop/Diario-Questoes/.planning/milestones/v1.3-ROADMAP.md) (Active)

---

## Active Milestone: v1.4 — Cloud Sync & Scale

- [x] **Phase 16 — Cloud Sync (Local-First with Supabase)**
  - Auto-sync on every change (debounced 2s) + pull every 30s
  - Last-write-wins conflict resolution by timestamp
  - Email auth via Supabase
  - Sync status indicator in sidebar
  - Works 100% offline — localStorage stays primary
  - Setup: `SUPABASE_SETUP.md`

### Backlog (Future)

- [ ] useCallback / React.memo optimization
- [ ] Performance metrics by period
- [ ] Export as PDF/Report
- [ ] Data Analytics (to be discussed)
- [ ] Data Analytics (to be discussed)
