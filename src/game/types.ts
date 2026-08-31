import type { Rng } from "../lib/rng";

export type Screen = "menu" | "briefing" | "active" | "debrief";
export type ModuleKind = "wires" | "keypad" | "regulator" | "echo" | "signal";
export type ModuleStatus = "armed" | "solved";
export type MissionResult = "disarmed" | "detonated" | null;

/**
 * A WebMCP tool owned by the game. The webmcp layer adapts these specs to
 * document.modelContext.registerTool() and manages their AbortController lifecycles.
 */
export interface ToolSpec {
  name: string;
  title: string;
  description: string;
  inputSchema: object;
  /** True for sensors/lookups that never mutate device state. */
  readOnly?: boolean;
  /** Executes the tool. Returns agent-facing text. Throwing = tool error text. */
  execute(input: Record<string, unknown>): string | Promise<string>;
}

/** Services the device core hands to each module. */
export interface ModuleCtx {
  rng: Rng;
  serial: string;
  /** Register a strike against the device (wrong wire, mis-lock, ...). */
  strike(reason: string): void;
  /** Mark this module solved (green LED, tools for it are aborted). */
  solve(): void;
  /** Ask the UI layer to re-render this module. */
  update(): void;
  /** True while the mission is running (timer > 0, not detonated/disarmed). */
  missionLive(): boolean;
  /** Human-visible flavor events for the activity feed. */
  feed(text: string, tone?: FeedTone): void;
  /** Record a physical input. Irreversible means a confirmed cut/transmission. */
  humanAction(irreversible?: boolean): void;
}

export interface SessionTelemetry {
  agentReads: number;
  agentActuations: number;
  toolErrors: number;
  humanActions: number;
  irreversibleConfirmations: number;
  toolUsage: Record<string, number>;
}

export type FeedTone = "info" | "tool" | "good" | "bad" | "system";

export interface FeedEntry {
  at: number; // ms since mission start (or epoch ms if no mission)
  clock: string; // formatted mission clock, e.g. "04:12"
  text: string;
  tone: FeedTone;
}

/** A defusable module on the device. */
export interface GameModule {
  kind: ModuleKind;
  /** Stenciled label on the device face. */
  label: string;
  status: ModuleStatus;
  /** Render the human-facing interactive panel into the given root. */
  render(root: HTMLElement): void;
  /** One line for get_device_state: what the agent may know + what it must ask for. */
  agentSummary(): string;
  /** Module-scoped WebMCP tools, live only while the module is armed. */
  tools(): ToolSpec[];
  /** Optional real-time behavior (needle drift, beep loop). dt in ms. */
  tick?(dt: number): void;
}

export interface MissionDef {
  id: string;
  codename: string;
  tagline: string;
  seconds: number;
  modules: ModuleKind[];
  /** Short human briefing shown before the device is revealed. */
  brief: string;
}
