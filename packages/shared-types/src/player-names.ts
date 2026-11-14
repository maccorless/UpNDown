// New players get a random president mash-up such as "Donald Washington" as a starting name.
// They can type their own. The pieces are real first and last names of US presidents, each listed once
// (several presidents share George, John, James and William, and Johnson and Bush).
export const PRESIDENT_FIRST_NAMES = [
  'George', 'John', 'Thomas', 'James', 'Andrew', 'Martin', 'William', 'Zachary', 'Millard', 'Franklin',
  'Abraham', 'Ulysses', 'Rutherford', 'Chester', 'Grover', 'Benjamin', 'Theodore', 'Woodrow', 'Warren', 'Calvin',
  'Herbert', 'Harry', 'Dwight', 'Lyndon', 'Richard', 'Gerald', 'Ronald', 'Barack', 'Donald', 'Joseph'
] as const;

export const PRESIDENT_LAST_NAMES = [
  'Washington', 'Adams', 'Jefferson', 'Madison', 'Monroe', 'Jackson', 'Van Buren', 'Harrison', 'Tyler', 'Polk',
  'Taylor', 'Fillmore', 'Pierce', 'Buchanan', 'Lincoln', 'Johnson', 'Grant', 'Hayes', 'Garfield', 'Arthur',
  'Cleveland', 'McKinley', 'Roosevelt', 'Taft', 'Wilson', 'Harding', 'Coolidge', 'Hoover', 'Truman', 'Eisenhower',
  'Kennedy', 'Nixon', 'Ford', 'Carter', 'Reagan', 'Bush', 'Clinton', 'Obama', 'Trump', 'Biden'
] as const;

export function randomPresidentName(random: () => number = Math.random): string {
  const first = PRESIDENT_FIRST_NAMES[Math.floor(random() * PRESIDENT_FIRST_NAMES.length)] as string;
  const last = PRESIDENT_LAST_NAMES[Math.floor(random() * PRESIDENT_LAST_NAMES.length)] as string;
  return `${first} ${last}`;
}

// "Donald Washington" is shown as "Donald W" to save room. Only an exact mash-up from the lists is shortened,
// so a name someone typed ("Mary Ann") is never cut.
export function shortPlayerName(name: string): string {
  const space = name.indexOf(' ');
  if (space < 0) return name;
  const first = name.slice(0, space);
  const last = name.slice(space + 1);
  const isMashUp = (PRESIDENT_FIRST_NAMES as readonly string[]).includes(first)
    && (PRESIDENT_LAST_NAMES as readonly string[]).includes(last);
  return isMashUp ? `${first} ${last.charAt(0)}` : name;
}

// Control characters and the bidirectional overrides that can make a name render as someone else's.
const CONTROL_AND_BIDI = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;

export function cleanPlayerName(raw: string): string {
  return raw.replace(CONTROL_AND_BIDI, '').trim().slice(0, 32).trim();
}
