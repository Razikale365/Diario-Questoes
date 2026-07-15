import React from 'react';
import { CalendarDays, ListChecks, MoreHorizontal, Sparkles } from 'lucide-react';
import type { PrimaryDestination } from '../utils/appRoute';

export const PRIMARY_DESTINATIONS = [
  { id: 'today', label: 'IA Hoje', icon: Sparkles },
  { id: 'calendar', label: 'Calendário', icon: CalendarDays },
  { id: 'tasks', label: 'Tarefas', icon: ListChecks },
  { id: 'more', label: 'Mais', icon: MoreHorizontal },
] as const;

export const PrimaryNavigation: React.FC<{
  active: PrimaryDestination;
  onNavigate?: (destination: PrimaryDestination) => void;
}> = ({ active, onNavigate }) => (
  <nav aria-label="Navegação principal" className="study-primary-nav">
    {PRIMARY_DESTINATIONS.map(({ id, label, icon: Icon }) => (
      <a
        key={id}
        href={`#/${id}`}
        aria-current={active === id ? 'page' : undefined}
        onClick={() => onNavigate?.(id)}
        className="study-primary-link"
        data-selected={active === id}
      >
        <Icon aria-hidden="true" className="h-4 w-4" />
        <span>{label}</span>
      </a>
    ))}
  </nav>
);
