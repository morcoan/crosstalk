/** Minimal typed event bus that decouples the game core from UI and WebMCP layers. */
export type BusEvents = {
  /** Screen navigation changed (menu, briefing, active, debrief, manual). */
  screen: void;
  /** Any game/device state changed — device UI should re-render. */
  state: void;
  /** The set of live WebMCP tool REGISTRATIONS changed (register/abort) — UI badge refresh. */
  tools: void;
  /** Game lifecycle transition (armed, module solved, detonated) — WebMCP layer must resync. */
  lifecycle: void;
  /** An activity feed entry was appended. */
  feed: void;
};

type Handler = () => void;

const handlers = new Map<keyof BusEvents, Set<Handler>>();

export function on(event: keyof BusEvents, fn: Handler): () => void {
  let set = handlers.get(event);
  if (!set) {
    set = new Set();
    handlers.set(event, set);
  }
  set.add(fn);
  return () => set.delete(fn);
}

export function emit(event: keyof BusEvents): void {
  handlers.get(event)?.forEach((fn) => {
    try {
      fn();
    } catch (err) {
      console.error(`[bus] handler for "${event}" failed`, err);
    }
  });
}
