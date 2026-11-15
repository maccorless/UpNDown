import type { WriterLock } from '../../src/live/advisory-lock.js';

// A lock the test controls: it can be refused, granted, and lost, like the real connection-bound one.
export class FakeLock implements WriterLock {
  held = false;
  grant = true;
  attempts = 0;
  private listeners: Array<() => void> = [];

  async tryAcquire(): Promise<boolean> {
    this.attempts += 1;
    if (this.held) return true;
    if (!this.grant) return false;
    this.held = true;
    return true;
  }

  async release(): Promise<void> {
    this.held = false;
  }

  onLost(listener: () => void): void {
    this.listeners.push(listener);
  }

  lose(): void {
    this.held = false;
    this.listeners.forEach((listener) => listener());
  }
}
