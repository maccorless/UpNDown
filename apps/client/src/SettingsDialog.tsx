import type { GameSettings } from '@upndown/shared-types';
import { useState } from 'react';
import { Modal } from './Modal.js';
import { APP_VERSION } from './version.js';

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

interface SettingsDialogProps {
  mode: 'solitaire' | 'multiplayer';
  open: boolean;
  settings: GameSettings;
  editable: boolean;
  validationError: string | null;
  onClose: () => void;
  onSave?: () => void;
  onChange: (settings: GameSettings) => void;
  enableSounds: boolean;
  onToggleSounds: (val: boolean) => void;
}

export function SettingsDialog(props: SettingsDialogProps): JSX.Element | null {
  return props.open ? <OpenSettingsDialog {...props} /> : null;
}

function OpenSettingsDialog({
  mode,
  settings,
  editable,
  validationError,
  onClose,
  onSave,
  onChange,
  enableSounds,
  onToggleSounds
}: SettingsDialogProps): JSX.Element {
  const isSolitaire = mode === 'solitaire';
  // Parent resets the draft each time Settings opens, so this is the saved state for the whole visit.
  const [initial] = useState(settings);
  const [lowestText, setLowestText] = useState(String(settings.minCardValue));
  const dirty = JSON.stringify(settings) !== JSON.stringify(initial);
  const lowestError = lowestCardError(lowestText);
  const preset = detectPreset(settings);
  const deckSize = settings.maxCardValue - settings.minCardValue + 1;

  // The server requires at least 2 players, and the host may start whenever they want, so the minimum is fixed at 2.
  const update = (patch: Partial<GameSettings>): void => {
    const next = { ...settings, ...patch };
    onChange(isSolitaire ? next : { ...next, minPlayers: 2 });
  };

  const saveDisabled = !dirty || !!validationError || !!lowestError;
  const readOnlyMessage = isSolitaire
    ? 'Settings are locked while a game is in progress.'
    : 'Only the host can change these settings, and only before the game starts.';
  const chip = !editable ? 'View only' : isSolitaire ? 'Solitaire' : 'Host: applies to everyone';

  return (
    <Modal className="settings-sheet" dismiss="any" onClose={onClose} labelledBy="settings-title">
      <div className="settings-form">
        <header className="settings-head">
          <h2 id="settings-title">Game settings</h2>
          <span className="settings-chip">{chip}</span>
        </header>

        <div className="settings-body">
          {!editable ? <p className="settings-banner">{readOnlyMessage}</p> : null}
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
                </>
              )}
              <div><dt>Pile arrows</dt><dd>{yesNo(settings.showArrows)}</dd></div>
              <div><dt>Card Lookup cheat</dt><dd>{yesNo(settings.allowCardLookup)}</dd></div>
            </dl>
          ) : (
            <div className="settings-groups">
              <fieldset className="settings-group settings-group-wide">
                <legend>Difficulty</legend>
                <Segmented
                  name="settings-preset"
                  labelId="settings-title"
                  describedBy="settings-summary"
                  current={preset ?? 'custom'}
                  onPick={(value) => update(applyPreset(settings, DIFFICULTY_PRESETS[value as PresetName]))}
                  options={[
                    ...(Object.entries(DIFFICULTY_PRESETS) as [PresetName, DifficultyPreset][]).map(([value, p]) => ({ value, label: p.label })),
                    { value: 'custom', label: 'Custom', disabled: true }
                  ]}
                />
                <p className="settings-summary" id="settings-summary" aria-live="polite">
                  {preset ? DIFFICULTY_PRESETS[preset].label : 'Custom'}: {deckSize}-card deck ({settings.minCardValue} to {settings.maxCardValue}), hand of {settings.handSize}
                  {isSolitaire ? '' : `, play ${settings.minCardsPerTurn} per turn`}.
                </p>
              </fieldset>

              <fieldset className="settings-group settings-cards">
                <legend>Cards</legend>
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
                  <span className="settings-row-label" id="settings-hand-label">Hand size</span>
                  <Segmented
                    name="settings-hand"
                    labelId="settings-hand-label"
                    describedBy="settings-hand-hint"
                    current={String(settings.handSize)}
                    onPick={(value) => update({ handSize: Number(value) })}
                    options={[5, 6, 7, 8, 9].map((n) => ({ value: String(n), label: String(n) }))}
                  />
                  <span className="settings-hint" id="settings-hand-hint">A bigger hand is easier.</span>
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
                <details className="settings-adv" open={!!lowestError || !!validationError}>
                  <summary>Advanced</summary>
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
                </details>
              </fieldset>

              {isSolitaire ? null : (
                <fieldset className="settings-group">
                  <legend>Players</legend>
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
                    <span className="settings-hint" id="settings-max-players-hint">The host can start the game whenever at least 2 players have joined. More players is harder.</span>
                  </div>
                  <Switch
                    id="settings-private-game"
                    label="Private game"
                    hint="Hidden from the public list. Share the game ID to invite people."
                    checked={settings.privateGame}
                    onChange={(checked) => update({ privateGame: checked })}
                  />
                </fieldset>
              )}

              <fieldset className="settings-group">
                <legend>Everyone sees <span className="settings-tag">set by host</span></legend>
                <Switch
                  id="settings-show-arrows"
                  label="Pile arrows"
                  hint="An up or down arrow on each side of every foundation card."
                  checked={settings.showArrows}
                  onChange={(checked) => update({ showArrows: checked })}
                />
              </fieldset>
            </div>
          )}

          <fieldset className="settings-group">
            <legend>This device <span className="settings-tag">only you</span></legend>
            <Switch
              id="settings-sounds"
              label="Sound effects"
              hint="Card plays, special moves, turn starts and results."
              checked={enableSounds}
              onChange={onToggleSounds}
            />
          </fieldset>

          {editable ? (
            <details className="settings-adv">
              <summary>Cheats</summary>
              <Switch
                id="settings-card-lookup"
                label="Card Lookup"
                hint="Press Ctrl+Shift+C in a game to find where a card is. In multiplayer, everyone sees the result."
                checked={settings.allowCardLookup}
                onChange={(checked) => update({ allowCardLookup: checked })}
              />
            </details>
          ) : null}

          {validationError ? <p className="settings-error" role="alert">{validationError}</p> : null}
        </div>

        <footer className="settings-foot">
          <span className="settings-dirty" aria-live="polite">{editable && dirty ? 'Unsaved changes' : ''}</span>
          <span className="settings-version">v{APP_VERSION}</span>
          <button type="button" className="secondary" onClick={onClose}>{editable && dirty ? 'Discard' : 'Close'}</button>
          {editable ? (
            <button type="button" className="primary" onClick={onSave} disabled={saveDisabled}>
              Save settings
            </button>
          ) : null}
        </footer>
      </div>
    </Modal>
  );
}
