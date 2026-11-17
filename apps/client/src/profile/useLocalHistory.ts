import { useEffect, useMemo } from 'react';
import { createLocalHistory, type LocalHistory } from './local-history.js';

// One guest history for the page. It asks the browser to keep it (where the browser lets a page ask) once, on first use.
export function useLocalHistory(): LocalHistory {
  const history = useMemo(() => createLocalHistory(), []);
  useEffect(() => { history.requestPersistence(); }, [history]);
  return history;
}
