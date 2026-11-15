import type { GameState } from '@upndown/shared-types';
import { useCallback, useEffect, useState, type MutableRefObject } from 'react';
import { holdClaim, useUnclaimed } from './claims.js';
import { SAVED_SEAT_PREFIX, clearSavedSeat, listSavedSeats, writeSavedSeat } from './saved-seat.js';
import { newRunId } from './solitaire-result.js';

export interface SeatOffer {
  seatKey: string;
  gameId: string;
  claimId: string;
}

const offers = (): SeatOffer[] => listSavedSeats().map((seat) => ({ seatKey: seat.seatKey, gameId: seat.gameId, claimId: seat.seatKey }));

// Keeps this tab's multiplayer seat saved while a game is being played (and claimed, so other tabs are not offered it),
// forgets it when the game ends or the seat is lost, and lists the seats saved here that no other tab has open.
export function useSavedSeat(state: GameState | null, playerId: string | null, tokenRef: MutableRefObject<string | null>, landing: boolean): {
  seatKey: string | null;
  adopt: (seatKey: string) => void;
  forget: () => void;
  offers: SeatOffer[];
  refreshOffers: () => void;
} {
  const [seatKey, setSeatKey] = useState<string | null>(null);
  const [available, refreshOffers] = useUnclaimed(offers, 'seat:', SAVED_SEAT_PREFIX, landing);

  useEffect(() => {
    if (!state) return;
    if (state.gamePhase !== 'playing') {
      if (seatKey) clearSavedSeat(seatKey);
      if (seatKey) setSeatKey(null);
      return;
    }
    if (playerId && tokenRef.current && state.players.some((p) => p.id === playerId)) {
      const key = seatKey ?? newRunId();
      if (!seatKey) setSeatKey(key);
      writeSavedSeat({ seatKey: key, gameId: state.gameId, playerId, rejoinToken: tokenRef.current });
    }
  }, [state, playerId, seatKey, tokenRef]);

  useEffect(() => (seatKey ? holdClaim(`seat:${seatKey}`) : undefined), [seatKey]);

  const forget = useCallback((): void => {
    if (seatKey) clearSavedSeat(seatKey);
    setSeatKey(null);
  }, [seatKey]);

  return { seatKey, adopt: setSeatKey, forget, offers: available, refreshOffers };
}
