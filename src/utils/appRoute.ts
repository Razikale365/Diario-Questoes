import { useEffect, useState } from 'react';

export type PrimaryDestination = 'today' | 'calendar' | 'tasks' | 'more';
export interface AppRoute { destination: PrimaryDestination; params: URLSearchParams }

const DESTINATIONS = new Set<PrimaryDestination>(['today', 'calendar', 'tasks', 'more']);

export const parseAppRoute = (hash: string): AppRoute => {
  const raw = hash.replace(/^#\/?/, '');
  const separator = raw.indexOf('?');
  const path = separator >= 0 ? raw.slice(0, separator) : raw;
  const query = separator >= 0 ? raw.slice(separator + 1) : '';
  return {
    destination: DESTINATIONS.has(path as PrimaryDestination) ? path as PrimaryDestination : 'today',
    params: new URLSearchParams(query),
  };
};

export const buildAppHash = ({ destination, params }: AppRoute) => {
  const query = params.toString();
  return `#/${destination}${query ? `?${query}` : ''}`;
};

export const useAppRoute = () => {
  const [route, setRoute] = useState(() => parseAppRoute(window.location.hash));
  useEffect(() => {
    const refresh = () => setRoute(parseAppRoute(window.location.hash));
    window.addEventListener('hashchange', refresh);
    if (!window.location.hash || window.location.hash === '#/') window.location.replace('#/today');
    return () => window.removeEventListener('hashchange', refresh);
  }, []);
  return route;
};
