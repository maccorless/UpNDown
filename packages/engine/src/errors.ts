export type EngineErrorCode =
  | 'GAME_NOT_PLAYING'
  | 'INVALID_PLAYER_COUNT'
  | 'SOLITAIRE_PLAYER_COUNT_INVALID'
  | 'SOLITAIRE_SETTINGS_INVALID'
  | 'HOST_NOT_IN_PLAYERS'
  | 'INSUFFICIENT_DECK_FOR_DEAL'
  | 'NOT_PLAYER_TURN'
  | 'CARD_NOT_FOUND'
  | 'PILE_NOT_FOUND'
  | 'INVALID_PLAY'
  | 'MIN_CARDS_NOT_MET';

export class EngineError extends Error {
  public readonly code: EngineErrorCode;

  constructor(code: EngineErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
