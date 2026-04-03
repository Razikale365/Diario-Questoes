# Phase 2: localStorage Safety and TypeScript Strict Mode - Plan

**Goal:** Protect the app from data loss and silent type errors. Wrap all localStorage reads/writes in try/catch, enable TypeScript strict mode, and remove unused packages from the bundle.

## Step 1: Ensure localStorage Operations are Exception-Proof
- [x] Catch `getItem` errors when initializing `tasks` state. Return empty array on failure.
- [x] Catch `getItem` errors when initializing `activeTaskId` state. Return null on failure.
- [x] Catch `setItem` errors in the `useEffect` that synchronizes `tasks`. Alert user with a Toast error if `QuotaExceededError` prevents saving.
- [x] Catch `setItem` and `removeItem` errors in the `useEffect` that synchronizes `activeTaskId`.

## Step 2: Enable Strict TypeScript Compilation
- [x] Set `"strict": true` in the compilerOptions of `tsconfig.json`.
- [x] Ensure `@types/react` and `@types/react-dom` are installed to resolve JSX type inference errors.
- [x] Confirm no implicit `any` errors exist across the project codebase (via `npm run lint` or `npx tsc --noEmit`).

## Step 3: Bundle and Boilerplate Cleanup
- [x] Strip dependencies not actually required from `package.json` (such as `express`, `@google/genai`, `motion`, `dotenv`).
- [x] Remove the leftover `process.env.GEMINI_API_KEY` define logic from `vite.config.ts`.
- [x] Validate the production build passes (via `npm run build`).
