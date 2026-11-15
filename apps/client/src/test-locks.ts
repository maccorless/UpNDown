// A stand-in for navigator.locks: exclusive named locks, with ifAvailable, held until the holder's promise settles.
export function fakeLocks(): { held: Set<string>; remove: () => void } {
  const held = new Set<string>();
  const api = {
    request: (name: string, options: { ifAvailable?: boolean }, callback: (lock: { name: string } | null) => unknown): Promise<unknown> => {
      if (held.has(name)) return Promise.resolve(options?.ifAvailable ? callback(null) : undefined);
      held.add(name);
      return Promise.resolve(callback({ name })).finally(() => { held.delete(name); });
    },
    query: (): Promise<{ held: Array<{ name: string }> }> => Promise.resolve({ held: [...held].map((name) => ({ name })) })
  };
  Object.defineProperty(navigator, 'locks', { value: api, configurable: true });
  return { held, remove: () => { Reflect.deleteProperty(navigator, 'locks'); } };
}
