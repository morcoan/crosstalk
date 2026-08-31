import { store } from "../lib/dom";
import type { MissionResult, SessionTelemetry } from "./types";

export const TRAINING_STORE_KEY = "crosstalk.training.v1";

export interface MissionTrainingStats {
  attempts: number;
  wins: number;
  cleanWins: number;
  bestMsLeft: number;
  bestRating: string;
  lastPlayedAt: number;
  agentReads: number;
  agentActuations: number;
  toolErrors: number;
  humanActions: number;
  irreversibleConfirmations: number;
}

export interface TrainingRecordV1 {
  version: 1;
  missions: Record<string, MissionTrainingStats>;
}

export interface CompletedTrainingSession {
  missionId: string;
  result: Exclude<MissionResult, null>;
  msLeft: number;
  strikes: number;
  rating: string;
  telemetry: SessionTelemetry;
  completedAt: number;
}

export interface MissionChoice {
  id: string;
  codename: string;
}

const emptyStats = (): MissionTrainingStats => ({
  attempts: 0,
  wins: 0,
  cleanWins: 0,
  bestMsLeft: 0,
  bestRating: "—",
  lastPlayedAt: 0,
  agentReads: 0,
  agentActuations: 0,
  toolErrors: 0,
  humanActions: 0,
  irreversibleConfirmations: 0
});

export function emptyTrainingRecord(): TrainingRecordV1 {
  return { version: 1, missions: {} };
}

function finiteNonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function parseStats(value: unknown): MissionTrainingStats | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<MissionTrainingStats>;
  return {
    attempts: finiteNonNegative(row.attempts),
    wins: finiteNonNegative(row.wins),
    cleanWins: finiteNonNegative(row.cleanWins),
    bestMsLeft: finiteNonNegative(row.bestMsLeft),
    bestRating: typeof row.bestRating === "string" ? row.bestRating : "—",
    lastPlayedAt: finiteNonNegative(row.lastPlayedAt),
    agentReads: finiteNonNegative(row.agentReads),
    agentActuations: finiteNonNegative(row.agentActuations),
    toolErrors: finiteNonNegative(row.toolErrors),
    humanActions: finiteNonNegative(row.humanActions),
    irreversibleConfirmations: finiteNonNegative(row.irreversibleConfirmations)
  };
}

export function parseTrainingRecord(raw: string | null): TrainingRecordV1 {
  if (!raw) return emptyTrainingRecord();
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; missions?: unknown };
    if (parsed.version !== 1 || !parsed.missions || typeof parsed.missions !== "object") {
      return emptyTrainingRecord();
    }
    const missions: Record<string, MissionTrainingStats> = {};
    for (const [id, value] of Object.entries(parsed.missions)) {
      const stats = parseStats(value);
      if (stats) missions[id] = stats;
    }
    return { version: 1, missions };
  } catch {
    return emptyTrainingRecord();
  }
}

export function loadTrainingRecord(): TrainingRecordV1 {
  return parseTrainingRecord(store.get(TRAINING_STORE_KEY));
}

const ratingRank = (value: string): number => ({ S: 4, A: 3, B: 2, C: 1 }[value.charAt(0)] ?? 0);

export function applyCompletedSession(
  record: TrainingRecordV1,
  session: CompletedTrainingSession
): TrainingRecordV1 {
  const previous = record.missions[session.missionId] ?? emptyStats();
  const won = session.result === "disarmed";
  const replaceRating = won && ratingRank(session.rating) > ratingRank(previous.bestRating);
  return {
    version: 1,
    missions: {
      ...record.missions,
      [session.missionId]: {
        attempts: previous.attempts + 1,
        wins: previous.wins + (won ? 1 : 0),
        cleanWins: previous.cleanWins + (won && session.strikes === 0 ? 1 : 0),
        bestMsLeft: won ? Math.max(previous.bestMsLeft, session.msLeft) : previous.bestMsLeft,
        bestRating: replaceRating ? session.rating : previous.bestRating,
        lastPlayedAt: session.completedAt,
        agentReads: previous.agentReads + session.telemetry.agentReads,
        agentActuations: previous.agentActuations + session.telemetry.agentActuations,
        toolErrors: previous.toolErrors + session.telemetry.toolErrors,
        humanActions: previous.humanActions + session.telemetry.humanActions,
        irreversibleConfirmations:
          previous.irreversibleConfirmations + session.telemetry.irreversibleConfirmations
      }
    }
  };
}

export function saveCompletedSession(session: CompletedTrainingSession): TrainingRecordV1 {
  const next = applyCompletedSession(loadTrainingRecord(), session);
  store.set(TRAINING_STORE_KEY, JSON.stringify(next));
  return next;
}

export function recommendMission(record: TrainingRecordV1, missions: MissionChoice[]): MissionChoice {
  const incomplete = missions.find((mission) => (record.missions[mission.id]?.wins ?? 0) === 0);
  if (incomplete) return incomplete;
  return [...missions].sort((a, b) => {
    const sa = record.missions[a.id] ?? emptyStats();
    const sb = record.missions[b.id] ?? emptyStats();
    return ratingRank(sa.bestRating) - ratingRank(sb.bestRating) || sa.lastPlayedAt - sb.lastPlayedAt;
  })[0];
}

export function trainingTotals(record: TrainingRecordV1, missions: MissionChoice[]) {
  const rows = missions.map((mission) => record.missions[mission.id] ?? emptyStats());
  return {
    completed: rows.filter((row) => row.wins > 0).length,
    attempts: rows.reduce((sum, row) => sum + row.attempts, 0),
    wins: rows.reduce((sum, row) => sum + row.wins, 0),
    cleanWins: rows.reduce((sum, row) => sum + row.cleanWins, 0),
    agentReads: rows.reduce((sum, row) => sum + row.agentReads, 0),
    agentActuations: rows.reduce((sum, row) => sum + row.agentActuations, 0),
    toolErrors: rows.reduce((sum, row) => sum + row.toolErrors, 0),
    humanActions: rows.reduce((sum, row) => sum + row.humanActions, 0),
    irreversibleConfirmations: rows.reduce((sum, row) => sum + row.irreversibleConfirmations, 0)
  };
}
