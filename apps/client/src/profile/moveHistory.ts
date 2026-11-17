import type { ResultRow } from '@upndown/shared-types';
import type { LocalHistory } from './local-history.js';

// What the server accepts in one request is 90 KB and 250 rows; a row is about 460 bytes, so rows are packed by size first.
const MAX_ROWS = 150;
const MAX_BYTES = 80_000;
const THROTTLE_WAIT_MS = 5_000;
const MAX_THROTTLE_WAITS = 14;

export interface MoveResult {
  moved: number;
  remaining: number;
  // Games the server refused (too old, or not acceptable). They stay on the device, set apart.
  refused: number;
  error: 'none' | 'offline' | 'full' | 'server' | 'rejected';
}

interface Outcome { gameId: string; status: 'inserted' | 'duplicate' | 'rejected'; reason?: string }

function batchOf(rows: readonly ResultRow[]): ResultRow[] {
  const batch: ResultRow[] = [];
  let bytes = 20;
  for (const r of rows) {
    const size = JSON.stringify(r).length + 1;
    if (batch.length >= MAX_ROWS || (batch.length > 0 && bytes + size > MAX_BYTES)) break;
    batch.push(r);
    bytes += size;
  }
  return batch;
}

// Sends a guest's games to the account they just signed in to, a batch at a time. A game leaves the device only after the server
// has said it has it. Anything that goes wrong leaves the rest where it was, and running it again carries on.
export async function moveHistory(
  history: LocalHistory,
  fetchImpl: typeof fetch = (...a) => fetch(...a),
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); })
): Promise<MoveResult> {
  let moved = 0;
  let throttled = 0;
  let error: MoveResult['error'] = 'none';
  for (;;) {
    const rows = history.load().rows;
    if (rows.length === 0) break;
    const batch = batchOf(rows);
    let response: Response;
    try {
      response = await fetchImpl('/api/me/history-import', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: batch }) });
    } catch {
      error = 'offline';
      break;
    }
    if (response.status === 429) {
      throttled += 1;
      if (throttled > MAX_THROTTLE_WAITS) { error = 'server'; break; }
      await wait(THROTTLE_WAIT_MS);
      continue;
    }
    if (!response.ok) { error = 'server'; break; }
    let outcomes: Outcome[];
    try {
      outcomes = ((await response.json()) as { results: Outcome[] }).results;
    } catch { error = 'server'; break; }
    const done = outcomes.filter((o) => o.status !== 'rejected').map((o) => o.gameId);
    const full = outcomes.some((o) => o.status === 'rejected' && o.reason === 'history full');
    // A full account is not the game's fault: those rows stay as they are. Any other refusal is about the game itself.
    const refusedForGood = outcomes.filter((o) => o.status === 'rejected' && o.reason !== 'history full').map((o) => o.gameId);
    history.removeConfirmed(done);
    history.markRejected(refusedForGood);
    moved += outcomes.filter((o) => o.status === 'inserted' || o.status === 'duplicate').length;
    if (full) { error = 'full'; break; }
    // A batch that changed nothing would repeat forever: stop and say so.
    if (done.length === 0 && refusedForGood.length === 0) { error = 'server'; break; }
  }
  const after = history.load();
  if (error === 'none' && after.rejected.length > 0) error = 'rejected';
  return { moved, remaining: after.rows.length, refused: after.rejected.length, error };
}
