<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/948bbcb4-f76e-45aa-967e-d08ff90e23ab

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Study OS local service

`start-app.bat` starts the React app and the local Study OS service without
Docker. Study OS stores its command-layer state in
`data/study-os/study-os.sqlite3` by default. Set `STUDY_OS_DATA_DIR` to use a
different local data directory.

Run local-service maintenance commands with the project Python environment:

```powershell
.\.venv-study-os\Scripts\python.exe -m study_os_service.cli health
.\.venv-study-os\Scripts\python.exe -m study_os_service.cli backup
.\.venv-study-os\Scripts\python.exe -m study_os_service.cli export --output C:\Backups\study-os-portable.zip
```

Portable exports contain only a canonical manifest and an integrity-checked
SQLite snapshot. Restore validates the ZIP members, checksum, supported schema,
SQLite integrity, and foreign keys before replacing any local state.

Stop `start-app.bat` and the local Study OS service before restoring:

```powershell
.\.venv-study-os\Scripts\python.exe -m study_os_service.cli restore --from C:\Backups\study-os-portable.zip
```

When a database already exists, restore creates a verified pre-restore backup
under `data/study-os/backups` and rolls back to it if replacement fails.
