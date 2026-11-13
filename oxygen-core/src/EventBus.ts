import type { OxygenEventMap } from '../../sdk/src/types.js';

type Listener<T> = (payload: T) => void;

/**
 * Typed event-driven bus for Oxygen Core internal communication.
 * Replaces background polling with reactive subscriptions.
 */
export class EventBus {
  private readonly listeners = new Map<keyof OxygenEventMap, Set<Listener<any>>>();

  on<K extends keyof OxygenEventMap>(
    event: K,
    listener: Listener<OxygenEventMap[K]>
  ): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
      if (set && set.size === 0) {
        this.listeners.delete(event);
      }
    };
  }

  emit<K extends keyof OxygenEventMap>(event: K, payload: OxygenEventMap[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of [...set]) {
      listener(payload);
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
