import { useEffect, useRef } from 'react';
import { StudyTask } from '../types';

const BACKUP_INTERVAL_MS = 4 * 60 * 60 * 1000; // max one auto-download per 4 hours
const LAST_BACKUP_KEY = 'ls_last_auto_backup';

function triggerDownload(tasks: StudyTask[]): void {
  try {
    const date = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', 'h');
    const filename = `diario-backup-${date}.json`;
    const blob = new Blob([JSON.stringify(tasks, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();

    // Cleanup after a short delay so the download has time to start
    setTimeout(() => {
      URL.revokeObjectURL(url);
      document.body.removeChild(a);
    }, 1000);

    localStorage.setItem(LAST_BACKUP_KEY, Date.now().toString());
    console.log(`[AutoBackup] Saved ${filename}`);
  } catch (e) {
    console.warn('[AutoBackup] Download failed:', e);
  }
}

function shouldDownload(): boolean {
  try {
    const last = localStorage.getItem(LAST_BACKUP_KEY);
    if (!last) return true;
    return Date.now() - parseInt(last, 10) > BACKUP_INTERVAL_MS;
  } catch {
    return true;
  }
}

/**
 * Auto-downloads a JSON backup when the page becomes hidden
 * (tab close, browser close, PC shutdown, screen lock, etc.).
 *
 * Rate-limited to once every 4 hours to avoid spamming on alt-tab.
 * The tasks ref is always up to date so the backup reflects current state.
 */
export function useAutoBackup(tasks: StudyTask[]): void {
  // Keep a ref so the event listener always reads the latest tasks
  // without needing to re-register on every change
  const tasksRef = useRef<StudyTask[]>(tasks);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    const handleHide = () => {
      if (tasksRef.current.length > 0 && shouldDownload()) {
        triggerDownload(tasksRef.current);
      }
    };

    // visibilitychange fires on: tab close, browser close, PC sleep/shutdown, screen lock
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') handleHide();
    });

    // pagehide is a backup — fires just before page is destroyed
    window.addEventListener('pagehide', handleHide);

    return () => {
      document.removeEventListener('visibilitychange', handleHide);
      window.removeEventListener('pagehide', handleHide);
    };
  }, []); // register once — tasksRef keeps it current
}
