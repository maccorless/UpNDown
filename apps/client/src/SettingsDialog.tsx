import { cheatLimitOf, deckFitMessage, maxPlayersFor, ROBOT_PAUSE_CHOICES_MS, ROBOT_PAUSE_DEFAULT_MS, withCheatLimits, type CheatKind, type CheatLimit, type GameSettings } from '@upndown/shared-types';
import { useState, type KeyboardEvent } from 'react';
import { Modal } from './Modal.js';
import { APP_VERSION } from './version.js';

const LIMIT_LABELS: Record<CheatLimit, string> = { off: 'Off', once: 'Once per game', unlimited: 'Unlimited' };
const LIMIT_OPTIONS = (['off', 'once', 'unlimited'] as const).map((value) => ({ value, label: value === 'once' ? 'Once' : LIMIT_LABELS[value] }));
const CHEAT_ROWS: Array<{ kind: CheatKind; label: string; hint: string }> = [
  { kind: 'lookup', label: 'Card seeker', hint: 'Find where a card is (Ctrl/Cmd-P). Only the asker sees the answer; the others are told one was used.' },
  { kind: 'monty', label: 'The Full Monty', hint: 'Shows every card from 1 to 100 in one grid (Ctrl/Cmd-Shift-M): in the draw pile, in a hand, or played, with cards outside this game grayed out. Only you see it; the others are told one was used.' },
  { kind: 'hint', label: 'Hint', hint: 'Suggests the best play from what you can see (Ctrl/Cmd-Shift-H). Only you see it; it is counted in the statistics.' },
  { kind: 'skip', label: 'Skip turn', hint: 'Pass your turn without the minimum (Ctrl/Cmd-S, after a confirmation). Before you are stuck, not after.' },
  { kind: 'trade', label: 'Trade a card', hint: 'Swap a hand card for the next draw card (Ctrl/Cmd-Shift-X). The card you give goes back in at random.' }
];
const pauseLabel = (ms: number): string => `${ms / 1000} s`;
const cheatRowsFor = (isSolitaire: boolean) => CHEAT_ROWS.filter((row) => !(isSolitaire && row.kind === 'skip'));

type PresetName = 'trivial' | 'easy' | 'normal' | 'hard';

interface DifficultyPreset {
  label: string;
  maxCardValue: number;
  handSize: number;
  minCardsPerTurn: number;
  autoRefillHand: boolean;
}

const DIFFICULTY_PRESETS: Record<PresetName, DifficultyPreset> = {
  trivial: { label: 'Trivial', maxCardValue: 29, handSize: 9, minCardsPerTurn: 1, autoRefillHand: true },
  easy:    { label: 'Easy',    maxCardValue: 59, handSize: 8, minCardsPerTurn: 1, autoRefillHand: true },
  normal:  { label: 'Normal',  maxCardValue: 99, handSize: 7, minCardsPerTurn: 2, autoRefillHand: false },
  hard:    { label: 'Hard',    maxCardValue: 99, handSize: 6, minCardsPerTurn: 3, autoRefillHand: false },
};

const PRESET_MIN_CARD = 2;
const MIN_DECK_SIZE = 18;
const LOWEST_CARD_MAX = 80;

function detectPreset(settings: GameSettings): PresetName | null {
  if (settings.minCardValue !== PRESET_MIN_CARD) return null;
  for (const [name, preset] of Object.entries(DIFFICULTY_PRESETS) as [PresetName, DifficultyPreset][]) {
    if (
      settings.maxCardValue === preset.maxCardValue &&
      settings.handSize === preset.handSize &&
      settings.minCardsPerTurn === preset.minCardsPerTurn &&
      settings.autoRefillHand === preset.autoRefillHand
    ) {
      return name;
    }
  }
  return null;
}

function applyPreset(settings: GameSettings, preset: DifficultyPreset): GameSettings {
  return {
    ...settings,
    minCardValue: PRESET_MIN_CARD,
    maxCardValue: preset.maxCardValue,
    handSize: preset.handSize,
    minCardsPerTurn: preset.minCardsPerTurn,
    autoRefillHand: preset.autoRefillHand
  };
}

function lowestCardError(text: string): string | null {
  const value = Number(text);
  if (text.trim() === '' || !Number.isInteger(value) || value < 2 || value > LOWEST_CARD_MAX) {
    return `Enter a whole number from 2 to ${LOWEST_CARD_MAX}.`;
  }
  return null;
}

const yesNo = (value: boolean): string => (value ? 'On' : 'Off');

interface SegmentedProps {
  name: string;
  labelId: string;
  describedBy: string;
  options: { value: string; label: string; disabled?: boolean }[];
  current: string;
  onPick: (value: string) => void;
}

function Segmented({ name, labelId, describedBy, options, current, onPick }: SegmentedProps): JSX.Element {
  return (
    <div className="seg" role="radiogroup" aria-labelledby={labelId} aria-describedby={describedBy}>
      {options.map((option) => (
        <label key={option.value}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={current === option.value}
            disabled={option.disabled}
            onChange={() => onPick(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}

interface SwitchProps {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function Switch({ id, label, hint, checked, onChange }: SwitchProps): JSX.Element {
  return (
    <label className="sw" htmlFor={id}>
      <span className="sw-text">
        <span className="sw-label">{label}</span>
        <span className="sw-hint">{hint}</span>
      </span>
      <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

interface PresetCardsProps {
  current: string;
  onPick: (value: PresetName) => void;
  describe: (preset: DifficultyPreset) => string;
}

// The difficulty levels as cards: each says in numbers what it means. Native radios, so the arrow keys work.
function PresetCards({ current, onPick, describe }: PresetCardsProps): JSX.Element {
  return (
    <div className="preset-cards" role="radiogroup" aria-labelledby="settings-difficulty-title" aria-describedby="settings-summary">
      {(Object.entries(DIFFICULTY_PRESETS) as [PresetName, DifficultyPreset][]).map(([value, preset]) => (
        <label key={value} className="preset-card">
          <input type="radio" name="settings-preset" value={value} checked={current === value} onChange={() => onPick(value)} />
          <span className="preset-card-face">
            <b>{preset.label}</b>
            <span>{describe(preset)}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

interface SettingsDialogProps {
  mode: 'solitaire' | 'multiplayer';
  open: boolean;
  settings: GameSettings;
  editable: boolean;
  validationError: string | null;
  saveError?: string | null;
  onClose: () => void;
  onSave?: () => void;
  onChange: (settings: GameSettings) => void;
  // Player settings: only this person's, applied at once, remembered on this device.
  enableSounds: boolean;
  onToggleSounds: (val: boolean) => void;
  showArrows: boolean;
  onToggleArrows: (val: boolean) => void;
  autoMark: boolean;
  onToggleAutoMark: (val: boolean) => void;
}

export function SettingsDialog(props: SettingsDialogProps): JSX.Element | null {
  return props.open ? <OpenSettingsDialog {...props} /> : null;
}

type SettingsTab = 'rules' | 'mine';

function OpenSettingsDialog({
  mode,
  settings,
  editable,
  validationError,
  saveError,
  onClose,
  onSave,
  onChange,
  enableSounds,
  onToggleSounds,
  showArrows,
  onToggleArrows,
  autoMark,
  onToggleAutoMark
}: SettingsDialogProps): JSX.Element {
  const isSolitaire = mode === 'solitaire';
  const [tab, setTab] = useState<SettingsTab>('rules');
  // Parent resets the draft each time Settings opens, so this is the saved state for the whole visit.
  const [initial] = useState(settings);
  const [lowestText, setLowestText] = useState(String(settings.minCardValue));
  const dirty = JSON.stringify(settings) !== JSON.stringify(initial);
  const lowestError = lowestCardError(lowestText);
  const preset = detectPreset(settings);
  const deckSize = settings.maxCardValue - settings.minCardValue + 1;
  const perTurn = isSolitaire ? '' : `, play ${settings.minCardsPerTurn} per turn`;

  // The server requires at least 2 players, and the host may start whenever they want, so the minimum is fixed at 2.
  const update = (patch: Partial<GameSettings>): void => {
    const next = { ...settings, ...patch };
    onChange(isSolitaire ? next : { ...next, minPlayers: 2 });
  };

  const saveDisabled = !dirty || !!validationError || !!lowestError;
  const rulesScope = !editable
    ? (isSolitaire ? 'Settings are locked while a game is in progress.' : 'Only the host can change these settings, and only before the game starts.')
    : isSolitaire
      ? 'These rules are for this solitaire game. They are fixed once it starts.'
      : 'These rules apply to everyone at the table. You are the host, so you can change them until the game starts. Other players can see them but not change them.';
  const describePreset = (p: DifficultyPreset): string => `${p.maxCardValue - PRESET_MIN_CARD + 1} cards, hand of ${p.handSize}${isSolitaire ? '' : `, play ${p.minCardsPerTurn}`}`;
  const onTabKey = (e: KeyboardEvent<HTMLElement>): void => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next: SettingsTab = tab === 'rules' ? 'mine' : 'rules';
    setTab(next);
    document.getElementById(`settings-tab-${next}`)?.focus();
  };

  return (
    <Modal className="settings-sheet" dismiss="any" onClose={onClose} labelledBy="settings-title">
      <div className="settings-form">
        <header className="settings-head">
          <h2 id="settings-title">Settings</h2>
        </header>

        <div className="settings-tabs" role="tablist" aria-label="Settings">
          <button type="button" role="tab" id="settings-tab-rules" aria-selected={tab === 'rules'} aria-controls="settings-panel-rules" tabIndex={tab === 'rules' ? 0 : -1} onClick={() => setTab('rules')} onKeyDown={onTabKey}>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="9" cy="8" r="3.2" /><circle cx="17" cy="9" r="2.4" /><path d="M3 20c0-3.4 2.7-5.5 6-5.5s6 2.1 6 5.5" /><path d="M16 14.6c2.6 0 5 1.6 5 4.4" /></svg>
            <span>Game rules<small>{isSolitaire ? 'This game' : 'Everyone at the table'}</small></span>
          </button>
          <button type="button" role="tab" id="settings-tab-mine" aria-selected={tab === 'mine'} aria-controls="settings-panel-mine" tabIndex={tab === 'mine' ? 0 : -1} onClick={() => setTab('mine')} onKeyDown={onTabKey}>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="8" r="3.6" /><path d="M5 20c0-3.8 3-6 7-6s7 2.2 7 6" /></svg>
            <span>My settings<small>Only you</small></span>
          </button>
        </div>

        <div className="settings-body">
          {tab === 'rules' ? (
            <div role="tabpanel" id="settings-panel-rules" aria-labelledby="settings-tab-rules" className="settings-panel">
              <p className="settings-scope">
                {!editable ? <span className="settings-chip">View only</span> : null}
                <span>{rulesScope}</span>
              </p>
              {!editable ? (
                <dl className="settings-facts">
                  <div><dt>Difficulty</dt><dd>{preset ? DIFFICULTY_PRESETS[preset].label : 'Custom'}</dd></div>
                  <div><dt>Deck</dt><dd>{deckSize} cards ({settings.minCardValue} to {settings.maxCardValue})</dd></div>
                  <div><dt>Hand size</dt><dd>{settings.handSize}</dd></div>
                  {isSolitaire ? null : (
                    <>
                      <div><dt>Cards per turn</dt><dd>{settings.minCardsPerTurn}</dd></div>
                      <div><dt>Auto refill hand</dt><dd>{yesNo(settings.autoRefillHand)}</dd></div>
                      <div><dt>Maximum players</dt><dd>{settings.maxPlayers}</dd></div>
                      <div><dt>Private game</dt><dd>{yesNo(settings.privateGame)}</dd></div>
                      <div><dt>Robot pause</dt><dd>{pauseLabel(settings.robotPauseMs ?? ROBOT_PAUSE_DEFAULT_MS)}</dd></div>
                    </>
                  )}
                  {cheatRowsFor(isSolitaire).map((row) => (
                    <div key={row.kind}><dt>{row.label}</dt><dd>{LIMIT_LABELS[cheatLimitOf(settings, row.kind)]}</dd></div>
                  ))}
                </dl>
              ) : (
                <>
                  <section className="settings-section" aria-labelledby="settings-difficulty-title">
                    <h3 id="settings-difficulty-title">How hard should it be?</h3>
                    <p className="settings-why">Pick a level. Each one sets the deck, the hand and how many cards you must play.</p>
                    <PresetCards current={preset ?? ''} onPick={(value) => update(applyPreset(settings, DIFFICULTY_PRESETS[value]))} describe={describePreset} />
                    <p className="settings-summary" id="settings-summary" aria-live="polite">
                      {preset ? DIFFICULTY_PRESETS[preset].label : 'Custom'}: {deckSize}-card deck ({settings.minCardValue} to {settings.maxCardValue}), hand of {settings.handSize}{perTurn}.
                    </p>
                    <details className="settings-adv" open={!preset || !!lowestError || !!validationError}>
                      <summary>
                        <span>Fine-tune the deal</span>
                        <span className="settings-adv-now">Cards {settings.minCardValue} to {settings.maxCardValue}, hand {settings.handSize}{perTurn}</span>
                      </summary>
                      <div className="settings-row">
                        <div className="settings-row-top">
                          <label className="settings-row-label" htmlFor="settings-max-card">Highest card</label>
                          <output htmlFor="settings-max-card">{settings.maxCardValue}</output>
                        </div>
                        <input
                          id="settings-max-card"
                          type="range"
                          min={Math.min(99, settings.minCardValue + MIN_DECK_SIZE - 1)}
                          max={99}
                          value={settings.maxCardValue}
                          aria-describedby="settings-max-card-hint"
                          onChange={(e) => update({ maxCardValue: Number(e.target.value) })}
                        />
                        <span className="settings-hint" id="settings-max-card-hint">A higher top card means a bigger deck, which is harder.</span>
                      </div>
                      <div className="settings-row">
                        <label className="settings-row-label" htmlFor="settings-min-card">Lowest card</label>
                        <input
                          id="settings-min-card"
                          className="settings-number"
                          type="number"
                          inputMode="numeric"
                          min={2}
                          max={LOWEST_CARD_MAX}
                          value={lowestText}
                          aria-invalid={lowestError ? 'true' : 'false'}
                          aria-describedby="settings-min-card-hint settings-min-card-error"
                          onChange={(e) => {
                            setLowestText(e.target.value);
                            if (lowestCardError(e.target.value) === null) update({ minCardValue: Number(e.target.value) });
                          }}
                        />
                        <span className="settings-hint" id="settings-min-card-hint">Raising it shrinks the deck, which is easier. The deck needs at least {MIN_DECK_SIZE} cards.</span>
                        <span className="settings-error" id="settings-min-card-error" role="alert">{lowestError ?? ''}</span>
                      </div>
                      <div className="settings-row">
                        <span className="settings-row-label" id="settings-hand-label">Hand size</span>
                        <Segmented
                          name="settings-hand"
                          labelId="settings-hand-label"
                          describedBy="settings-hand-hint"
                          current={String(settings.handSize)}
                          onPick={(value) => update({ handSize: Number(value) })}
                          options={[5, 6, 7, 8, 9, 10, 11].map((n) => ({ value: String(n), label: String(n) }))}
                        />
                        <span className="settings-hint" id="settings-hand-hint">A bigger hand is easier.</span>
                        {isSolitaire || !deckFitMessage(settings) ? null : (
                          <span className="settings-hint settings-hint-warning" role="alert">{deckFitMessage(settings)}</span>
                        )}
                      </div>
                      {isSolitaire ? null : (
                        <>
                          <div className="settings-row">
                            <span className="settings-row-label" id="settings-turn-label">Cards you must play each turn</span>
                            <Segmented
                              name="settings-turn"
                              labelId="settings-turn-label"
                              describedBy="settings-turn-hint"
                              current={String(settings.minCardsPerTurn)}
                              onPick={(value) => update({ minCardsPerTurn: Number(value) })}
                              options={[1, 2, 3].map((n) => ({ value: String(n), label: String(n) }))}
                            />
                            <span className="settings-hint" id="settings-turn-hint">More cards per turn is harder. The last turn with an empty draw pile only needs 1.</span>
                          </div>
                          <Switch
                            id="settings-auto-refill"
                            label="Auto refill hand"
                            hint="Draw cards immediately after each play. Easier."
                            checked={settings.autoRefillHand}
                            onChange={(checked) => update({ autoRefillHand: checked })}
                          />
                        </>
                      )}
                    </details>
                  </section>

                  {isSolitaire ? null : (
                    <section className="settings-section" aria-labelledby="settings-players-title">
                      <h3 id="settings-players-title">Who can play?</h3>
                      <div className="settings-row">
                        <label className="settings-row-label" htmlFor="settings-max-players">Maximum players</label>
                        <select
                          id="settings-max-players"
                          className="settings-select"
                          value={settings.maxPlayers}
                          aria-describedby="settings-max-players-hint"
                          onChange={(e) => update({ maxPlayers: Number(e.target.value) })}
                        >
                          {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                        <span className="settings-hint" id="settings-max-players-hint">
                          The host can start the game whenever at least 2 players have joined. More players is harder.
                          {!deckFitMessage(settings) && maxPlayersFor(settings) < settings.maxPlayers ? ` With this deck and hand, at most ${maxPlayersFor(settings)} players can be dealt in.` : ''}
                        </span>
                      </div>
                      <Switch
                        id="settings-private-game"
                        label="Private game"
                        hint="Hidden from the public list. Share the game ID to invite people."
                        checked={settings.privateGame}
                        onChange={(checked) => update({ privateGame: checked })}
                      />
                    </section>
                  )}

                  {isSolitaire ? null : (
                    <section className="settings-section" aria-labelledby="settings-robots-title">
                      <h3 id="settings-robots-title">Robots</h3>
                      <div className="settings-row">
                        <span className="settings-row-label" id="settings-robot-pause-label">Pause before each robot play</span>
                        <Segmented
                          name="settings-robot-pause"
                          labelId="settings-robot-pause-label"
                          describedBy="settings-robot-pause-hint"
                          current={String(settings.robotPauseMs ?? ROBOT_PAUSE_DEFAULT_MS)}
                          onPick={(value) => update({ robotPauseMs: Number(value) })}
                          options={ROBOT_PAUSE_CHOICES_MS.map((ms) => ({ value: String(ms), label: pauseLabel(ms) }))}
                        />
                        <span className="settings-hint" id="settings-robot-pause-hint">How long a robot waits before each card it plays and before ending its turn (up to as long again, at random). A short pause leaves people no time to mark piles before the robot plays.</span>
                      </div>
                    </section>
                  )}

                  <section className="settings-section" aria-labelledby="settings-cheats-title">
                    <h3 id="settings-cheats-title">Cheats</h3>
                    <p className="settings-why">Help for anyone who wants it. Each use is counted and shown on the end screen. Once means one use per player per game.</p>
                    <p className="settings-why" data-testid="settings-cheats-phone">No keyboard on a phone? While a game has a cheat on, a Cheats button appears on the game board. Tap it to open the panel, or double tap the logo.</p>
                    {cheatRowsFor(isSolitaire).map((row) => (
                      <div className="settings-row" key={row.kind}>
                        <span className="settings-row-label" id={`settings-cheat-${row.kind}-label`}>{row.label}</span>
                        <Segmented
                          name={`settings-cheat-${row.kind}`}
                          labelId={`settings-cheat-${row.kind}-label`}
                          describedBy={`settings-cheat-${row.kind}-hint`}
                          current={cheatLimitOf(settings, row.kind)}
                          onPick={(value) => update(withCheatLimits({ ...settings, cheatLimits: { ...withCheatLimits(settings).cheatLimits!, [row.kind]: value as CheatLimit } }))}
                          options={LIMIT_OPTIONS}
                        />
                        <span className="settings-hint" id={`settings-cheat-${row.kind}-hint`}>{row.hint}</span>
                      </div>
                    ))}
                  </section>
                </>
              )}
              {validationError ? <p className="settings-error" role="alert">{validationError}</p> : null}
              {saveError && !validationError ? <p className="settings-error" role="alert">{saveError}</p> : null}
            </div>
          ) : (
            <div role="tabpanel" id="settings-panel-mine" aria-labelledby="settings-tab-mine" className="settings-panel">
              <p className="settings-scope">
                <span>Only you see and hear these. They take effect as soon as you change them, even in the middle of a game, and they are remembered on this device.</span>
              </p>
              <section className="settings-section" aria-labelledby="settings-sound-title">
                <h3 id="settings-sound-title">Sound</h3>
                <Switch
                  id="settings-sounds"
                  label="Sound effects"
                  hint="Card plays, special moves, turn starts and results. Your turn also vibrates on phones."
                  checked={enableSounds}
                  onChange={onToggleSounds}
                />
              </section>
              <section className="settings-section" aria-labelledby="settings-board-title">
                <h3 id="settings-board-title">On the board</h3>
                <Switch
                  id="settings-show-arrows"
                  label="Pile arrows"
                  hint="An up or down arrow beside every foundation card."
                  checked={showArrows}
                  onChange={onToggleArrows}
                />
              </section>
              {isSolitaire ? null : (
                <section className="settings-section" aria-labelledby="settings-marking-title">
                  <h3 id="settings-marking-title">Marking piles <span className="settings-tag">tables only</span></h3>
                  <p className="settings-why">At a table, the others mark piles to say which ones they want. Marking yours is optional.</p>
                  <Switch
                    id="settings-auto-mark"
                    label="Auto-mark piles"
                    hint="While someone else is on turn, the game marks every pile for you as Like, Love or Really love, by the same rule the robots use. Nothing shows on your own turn."
                    checked={autoMark}
                    onChange={onToggleAutoMark}
                  />
                </section>
              )}
            </div>
          )}
        </div>

        <footer className="settings-foot">
          <span className="settings-dirty" aria-live="polite">
            {editable && dirty ? (tab === 'rules' ? 'Unsaved changes' : 'Game rules have unsaved changes. Closing discards them.') : (tab === 'mine' ? 'Nothing to save on this tab.' : '')}
          </span>
          <span className="settings-version">v{APP_VERSION}</span>
          <button type="button" className="secondary" onClick={onClose}>{editable && dirty ? 'Discard' : 'Close'}</button>
          {editable && tab === 'rules' ? (
            <button type="button" className="primary" onClick={onSave} disabled={saveDisabled}>
              Save game rules
            </button>
          ) : null}
        </footer>
      </div>
    </Modal>
  );
}
