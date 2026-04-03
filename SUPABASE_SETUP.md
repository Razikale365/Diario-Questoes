# Supabase Setup Guide — Diario-Questoes Cloud Sync

## 1. Create a Supabase Project

1. Go to https://supabase.com and sign up (free tier is fine)
2. Click **"New Project"**
3. Choose an organization (or create one)
4. Fill in:
   - **Project name**: `diario-questoes` (or whatever you want)
   - **Database password**: generate a strong one and save it somewhere
   - **Region**: pick the closest to you (e.g., `South America (Brazil)` or `US East`)
5. Click **"Create new project"** — wait ~2 minutes for it to spin up

## 2. Get Your API Keys

1. In your Supabase dashboard, go to **Project Settings** (gear icon, bottom-left)
2. Click **API** in the sidebar
3. Copy these two values:
   - **Project URL** → looks like `https://xxxxx.supabase.co`
   - **anon public** key → a long string under `Project API keys`

## 3. Configure Your `.env` File

Create or edit `.env` in the project root:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

Replace with the values you copied. **Restart the dev server** after changing `.env`.

## 4. Create the Database Table

1. In Supabase dashboard, click **SQL Editor** (left sidebar)
2. Click **"New query"**
3. Paste the SQL below and click **Run**

```sql
-- Create the sync data table
CREATE TABLE diario_ls_sync (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payload JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE diario_ls_sync ENABLE ROW LEVEL SECURITY;

-- Policy: users can only see their own data
CREATE POLICY "Users can only access their own data"
  ON diario_ls_sync
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Index for faster lookups
CREATE INDEX idx_diario_ls_sync_user_id ON diario_ls_sync(user_id);
```

## 5. Enable Email Authentication

1. In Supabase dashboard, go to **Authentication** → **Providers**
2. Make sure **Email** is enabled (it should be by default)
3. Optionally enable **Google** or other providers under the same page
4. Go to **Authentication** → **URL Configuration** and add your dev URL to allowed redirect URLs:
   - `http://localhost:3000`

## 6. Test It

1. Start the dev server: `npm run dev`
2. Open `http://localhost:3000`
3. Look at the bottom of the sidebar — you should see a **"Login"** status indicator
4. Click **"Fazer login"** → **"Não tem conta? Criar"** to sign up
5. After signing up, the sync status should change to **"Sincronizando..."** then **"Sincronizado"**
6. Your data will now sync to the cloud automatically on every change

## How It Works

- **Local-first**: All data is always in localStorage first — instant, works offline
- **Auto-sync**: Every change is pushed to Supabase after a 2-second debounce
- **Pull on start**: When the app loads, it checks Supabase for newer data
- **Pull every 30s**: Periodic check for changes from other devices
- **Last-write-wins**: If the same task is edited on two devices, the most recent change wins
- **Offline**: If you lose internet, changes queue locally and sync when you're back online

## Troubleshooting

| Issue | Fix |
|---|---|
| "Supabase not configured" toast | Make sure `.env` has both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` |
| Sync stuck on "Sincronizando..." | Check browser console for errors. Verify the table was created in Supabase |
| "Email already registered" | You already signed up — use the login form instead |
| Data not syncing between devices | Make sure both devices are logged into the same Supabase account |
| Build hangs on tailwindcss | This is a pre-existing issue unrelated to sync — use `npm run dev` instead |
