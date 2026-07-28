import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { DataManagementPage } from './DataManagementPage';

const noOp = () => undefined;
const baseProps = {
  onBack: noOp,
  onExport: noOp,
  onImport: noOp,
  onMerge: noOp,
  onPaste: noOp,
  onSyncNow: noOp,
  onAuth: noOp,
  onChangePassword: noOp,
  onDisconnect: noOp,
};

test('account view explains that localhost must sign in instead of trapping the user in password change', () => {
  const html = renderToStaticMarkup(createElement(DataManagementPage, {
    ...baseProps,
    view: 'account',
    syncState: {
      status: 'unauthenticated',
      lastSyncAt: null,
      lastError: null,
      pendingChanges: 0,
    },
  }));

  assert.match(html, /Esta origem ainda não está conectada/);
  assert.match(html, /Entrar na nuvem/);
  assert.match(html, /localhost/);
  assert.doesNotMatch(html, /Definir Nova Senha/);
});

test('backup view exposes the complete LAN-to-localhost transfer path', () => {
  const html = renderToStaticMarkup(createElement(DataManagementPage, {
    ...baseProps,
    view: 'backup',
    syncState: {
      status: 'synced',
      lastSyncAt: '2026-07-28T12:00:00.000Z',
      lastError: null,
      pendingChanges: 0,
    },
  }));

  assert.match(html, /Exportar JSON/);
  assert.match(html, /Mesclar backup no localhost/);
  assert.match(html, /não apaga as tarefas que já existem/);
  assert.match(html, /Sincronizar agora/);
});
