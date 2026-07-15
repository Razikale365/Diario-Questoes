import React from 'react';
import type { PrimaryDestination } from '../utils/appRoute';
import { PrimaryNavigation } from './PrimaryNavigation';

export const AppShell: React.FC<{
  destination: PrimaryDestination;
  onNavigate: (destination: PrimaryDestination) => void;
  children: React.ReactNode;
}> = ({ destination, onNavigate, children }) => (
  <div className="study-shell">
    <header className="study-shell-header">
      <div>
        <p className="study-shell-eyebrow">Sprint SEFAZ CE</p>
        <strong className="study-shell-title">Sua próxima vitória, sem ruído.</strong>
      </div>
      <PrimaryNavigation active={destination} onNavigate={onNavigate} />
    </header>
    <div className="study-shell-content">{children}</div>
    <div className="study-shell-mobile-nav"><PrimaryNavigation active={destination} onNavigate={onNavigate} /></div>
  </div>
);
