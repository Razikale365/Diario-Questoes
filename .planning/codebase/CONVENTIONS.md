# CONVENTIONS.md — Code Style & Patterns

## Language
- **TypeScript** with `isolatedModules: true` and `noEmit: true`
- `skipLibCheck: true` — library types not strictly checked
- `allowJs: true` — JS files permitted but not used
- No `strict: true` — TypeScript is **not strict** (notable omission)
- Lint script: `tsc --noEmit` (type-check only, no ESLint configured)

---

## React Patterns

### Component Style
- **Functional components only** — class components not used
- Single `App()` function component containing all UI and logic
- Props not used (no child components exists)

### Hooks Usage
```tsx
// State initialization with lazy initializer for localStorage
const [tasks, setTasks] = useState<StudyTask[]>(() => {
  const saved = localStorage.getItem('ls_tasks_v2');
  return saved ? JSON.parse(saved) : [];
});

// Side effects
useEffect(() => {
  localStorage.setItem('ls_tasks_v2', JSON.stringify(tasks));
}, [tasks]);

// Expensive derivations cached
const activeTask = useMemo(() => tasks.find(t => t.id === activeTaskId), [tasks, activeTaskId]);
```

### State Updates
- Always uses **functional updater form** for state depending on previous state:
  ```tsx
  setTasks(prev => prev.map(task => {
    if (task.id !== activeTaskId) return task;
    return { ...task, ...updatedFields };
  }));
  ```
- **Immutable updates only** — spread operator for all object mutations
- No direct state mutation

---

## Naming Conventions

### Functions
| Pattern | Example |
|---|---|
| `handle*` | `handleImport`, `handleDeleteBlock`, `handleCopy` |
| `save*` | `saveTaskEdits`, `saveBlockEdit` |
| `open*` | `openEditBlock` |
| Verb+Noun | `finishTask`, `deleteTask`, `toggleLock`, `undoDeleteBlock` |
| `parse*` | `parseLSTask`, `parseQuestionsText` |
| `format*` | `formatQuestionList` |

### Variables
| Pattern | Example |
|---|---|
| camelCase state | `activeTaskId`, `importDiscipline`, `gabaritoModal` |
| SCREAMING_SNAKE constants | `BANKS`, `PLANEJAMENTOS`, `DISCIPLINAS` |
| Derived values | `activeTask`, `uniqueDisciplines`, `availableLessons`, `generatedRevision` |

### TypeScript
| Pattern | Example |
|---|---|
| Interfaces | `StudyTask`, `ActivityBlock`, `Question` |
| Union types | `'in_progress' \| 'completed'`, `boolean \| null` |
| Generic usage | `useState<StudyTask[]>`, `useMemo<...>`, `Set<string>` |

---

## Code Style

### Conditionals in JSX
- Uses `&&` short-circuit for optional rendering:
  ```tsx
  {toastMessage && <div>...</div>}
  {activeTask.assunto && <p>{activeTask.assunto}</p>}
  ```
- Uses ternary for if/else rendering:
  ```tsx
  {!activeTask ? (<ImportForm />) : (<ActiveTaskView />)}
  ```

### Template Literals
- Tailwind class composition via template literals:
  ```tsx
  className={`p-1.5 rounded transition-colors ${q.isCorrect === true ? 'bg-green-600 text-white' : 'bg-[#404040]'}`}
  ```

### Type Assertions
- Non-null assertion `!` used in:
  ```tsx
  document.getElementById('root')!  // main.tsx
  grouped.get(key)!                  // guaranteed by has() check
  ```

### Arrow Functions
- All function components and handlers use arrow function syntax
- Inline arrow functions in JSX event handlers:
  ```tsx
  onChange={(e) => setImportPlanejamento(e.target.value)}
  onClick={() => openEditBlock(block)}
  ```

---

## UI Patterns

### Color Palette (hardcoded Tailwind arbitrary values)
| Token | Hex | Used For |
|---|---|---|
| `bg-[#2d2d2d]` | `#2d2d2d` | Main background |
| `bg-[#333333]` | `#333333` | Card backgrounds |
| `bg-[#262626]` | `#262626` | Card headers, input fields |
| `bg-[#404040]` | `#404040` | Interactive elements bg |
| `bg-[#525252]` | `#525252` | Hover states |
| `bg-[#5c2092]` | `#5c2092` | Sidebar (purple) |
| `bg-[#84cc16]` | `#84cc16` | Primary CTA (lime green) |
| `bg-[#65a30d]` | `#65a30d` | CTA hover |
| `text-purple-600` | Tailwind | Focus rings, icon accents |
| `text-[#eab308]` | `#eab308` | Doubt flag color (yellow) |

### Button Patterns
All buttons follow this class pattern:
```tsx
className="bg-[color] hover:bg-[hover-color] text-white px-N py-N rounded font-bold 
           flex items-center gap-2 transition-colors [disabled styles]"
```

### Input Patterns
All text inputs share:
```tsx
className="w-full bg-[#404040] border border-[#525252] rounded px-4 py-2 text-white 
           focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
```

### Toast Notification Pattern
- Duration: 3 seconds via `setTimeout`
- Two toast types:
  - Success (top-right, lime green bg): `showToast(message)`
  - Undo action (bottom-right, dark bg): `deletedBlockInfo && <UndoToast />`
- Undo window: 10 seconds (`setTimeout(() => setDeletedBlockInfo(null), 10000)`)

### Modal Pattern
Modals use a fixed-position backdrop:
```tsx
<div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
  <div className="bg-[#262626] p-6 rounded-xl w-full max-w-[size] border border-[#404040] shadow-2xl">
    ...
  </div>
</div>
```

---

## Error Handling
- **No explicit try/catch anywhere** in the codebase
- localStorage access not wrapped in try/catch (will throw if storage is full/blocked)
- `JSON.parse` on stored data not guarded (potential parse error if data is corrupted)
- `confirm()` used for delete confirmation (browser native dialog)
- Validation: minimal — only checks for empty `importDiscipline` before import, and empty `importText`

---

## Portuguese Language
- All UI text is in **Brazilian Portuguese** (product is specific to Brazilian exam prep)
- Variable/function names are in **English**
- Constants like `DISCIPLINAS`, `PLANEJAMENTOS` contain Portuguese content values
