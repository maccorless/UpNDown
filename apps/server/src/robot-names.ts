import { uniqueInGameName } from './player-names.js';

// Robots are named after famous mathematicians. One word each, because a two-word name is shortened to its first word and an initial.
export const MATHEMATICIANS: readonly string[] = [
  'Euclid', 'Archimedes', 'Pythagoras', 'Hypatia', 'Fibonacci', 'Euler', 'Gauss', 'Riemann', 'Noether', 'Ramanujan',
  'Turing', 'Lovelace', 'Fermat', 'Pascal', 'Descartes', 'Newton', 'Leibniz', 'Cantor', 'Hilbert', 'Gödel',
  'Poincaré', 'Laplace', 'Lagrange', 'Galois', 'Abel', 'Cauchy', 'Fourier', 'Bernoulli', 'Napier', 'Kovalevskaya',
  'Germain', 'Mirzakhani', 'Hardy', 'Erdős', 'Conway', 'Neumann', 'Shannon', 'Kolmogorov', 'Dirichlet', 'Zeno',
  'Ptolemy', 'Khayyam', 'Brahmagupta', 'Banach', 'Tao', 'Perelman', 'Hopper', 'Johnson'
];

// A name nobody at the table has, chosen at random so tables differ; if (impossibly) every name is taken, the usual numbering applies.
export function pickRobotName(taken: readonly string[], random: () => number = Math.random): string {
  const used = new Set(taken.map((name) => name.trim().toLowerCase()));
  const free = MATHEMATICIANS.filter((name) => !used.has(name.toLowerCase()));
  if (free.length === 0) return uniqueInGameName(MATHEMATICIANS[0]!, taken);
  return free[Math.min(free.length - 1, Math.floor(random() * free.length))]!;
}
