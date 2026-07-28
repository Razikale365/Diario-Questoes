import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const authModalSource = readFileSync(new URL('./AuthModal.tsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const syncBadgeSource = readFileSync(new URL('./SyncStatusBadge.tsx', import.meta.url), 'utf8');
const syncEngineSource = readFileSync(new URL('../storage/SyncEngine.ts', import.meta.url), 'utf8');

test('cloud auth exposes the complete password recovery lifecycle', () => {
  assert.equal(authModalSource.includes('resetPasswordForEmail'), true);
  assert.match(authModalSource, /updateUser\(\{\s*password(?:\s*:|\s*\})/);
  assert.equal(authModalSource.includes("'forgot-password'"), true);
  assert.equal(authModalSource.includes("'update-password'"), true);
});

test('password recovery opens the reset form and remains reachable from a live session', () => {
  assert.equal(appSource.includes("event === 'PASSWORD_RECOVERY'"), true);
  assert.equal(syncBadgeSource.includes('Alterar senha'), true);
});

test('a newly signed-in session resumes cloud sync and More opens an explicit account page', () => {
  assert.match(
    syncEngineSource,
    /if \(this\.isInitialized\) return void this\.pullOnStart\(\)/,
  );
  assert.match(
    appSource,
    /id === 'backup' \|\| id === 'account'.*?window\.location\.hash = `#\/more\?view=\$\{id\}`/s,
  );
  assert.doesNotMatch(appSource, /id === 'account'.*?handleOpenPasswordChange\(\)/s);
});
