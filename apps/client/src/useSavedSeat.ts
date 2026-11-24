import type { GameState } from '@upndown/shared-types';
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { holdClaim, useUnclaimed } from './claims.js';
import { SAVED_SEAT_PREFIX, clearSavedSeat, listSavedSeats, writeSavedSeat, type SavedSeat } from './saved-seat.js';
import { newRunId } from './solitaire-result.js';

export interface SeatOffer {
  seatKey: string;
  gameId: string;
  claimId: string;
}

const offers = (): SeatOffer[] => listSavedSeats().map((seat) => ({ seatKey: seat.seatKey, gameId: seat.gameId, claimId: seat.seatKey }));

// Keeps this tab's multiplayer seat saved while a game is being played (and claimed, so other tabs are not offered it),
// forgets it when the game ends or the seat is lost, and lists the seats saved here that no other tab has open.
export function useSavedSeat(state: GameState | null, playerId: string | null, tokenRef: MutableRefObject<string | null>, landing: boolean, signedIn = false, checkLive: (seat: SavedSeat) => Promise<boolean> = async () => true): {
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
      writeSavedSeat({ seatKey: key, gameId: state.gameId, playerId, rejoinToken: tokenRef.current, signedIn });
    }
  }, [state, playerId, seatKey, tokenRef, signedIn]);

  useEffect(() => (seatKey ? holdClaim(`seat:${seatKey}`) : undefined), [seatKey]);

  const forget = useCallback((): void => {
    if (seatKey) clearSavedSeat(seatKey);
    setSeatKey(null);
  }, [seatKey]);

  // Offers only the seats the server still holds. A game that is gone or ended, or where the host removed this seat, is left out.
  const [live, setLive] = useState<SeatOffer[]>([]);
  const checkRef = useRef(checkLive);
  checkRef.current = checkLive;
  useEffect(() => {
    let current = true;
    const saved = listSavedSeats();
    void Promise.all(available.map(async (offer) => {
      const seat = saved.find((s) => s.seatKey === offer.seatKey);
      return seat && (await checkRef.current(seat)) ? offer : null;
    })).then((results) => { if (current) setLive(results.filter((offer): offer is SeatOffer => offer !== null)); });
    return () => { current = false; };
  }, [available]);

  return { seatKey, adopt: setSeatKey, forget, offers: live, refreshOffers };
}
