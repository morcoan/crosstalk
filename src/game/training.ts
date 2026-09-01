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

export interface TrainingSaveResult {
  record: TrainingRecordV1;
  persisted: boolean;
}

const MAX_COUNTER = 1_000_000_000;
const MAX_SESSION_MS = 24 * 60 * 60 * 1000;
const VALID_RATINGS = new Set([
  "—",
  "S — FLAWLESS CROSSTALK",
  "A — CLEAN HANDS",
  "B — SINGED",
  "C — SMOKING"
]);

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

function boundedInteger(value: unknown, max = MAX_COUNTER): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max ? value : 0;
}

function boundedMs(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_SESSION_MS
    ? Math.floor(value)
    : 0;
}

function timestamp(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function safeAdd(a: number, b: number): number {
  return Math.min(MAX_COUNTER, a + b);
}

function parseStats(value: unknown): MissionTrainingStats | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Partial<MissionTrainingStats>;
  const attempts = boundedInteger(row.attempts);
  const wins = Math.min(attempts, boundedInteger(row.wins));
  const cleanWins = Math.min(wins, boundedInteger(row.cleanWins));
  const humanActions = boundedInteger(row.humanActions);
  return {
    attempts,
    wins,
    cleanWins,
    bestMsLeft: boundedMs(row.bestMsLeft),
    bestRating: typeof row.bestRating === "string" && VALID_RATINGS.has(row.bestRating) ? row.bestRating : "—",
    lastPlayedAt: timestamp(row.lastPlayedAt),
    agentReads: boundedInteger(row.agentReads),
    agentActuations: boundedInteger(row.agentActuations),
    toolErrors: boundedInteger(row.toolErrors),
    humanActions,
    irreversibleConfirmations: Math.min(humanActions, boundedInteger(row.irreversibleConfirmations))
  };
}

export function normalizeTrainingRecord(value: unknown): TrainingRecordV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyTrainingRecord();
  const parsed = value as { version?: unknown; missions?: unknown };
  if (parsed.version !== 1 || !parsed.missions || typeof parsed.missions !== "object" || Array.isArray(parsed.missions)) {
    return emptyTrainingRecord();
  }
  const missions: Record<string, MissionTrainingStats> = {};
  for (const [id, row] of Object.entries(parsed.missions)) {
    if (!/^[a-z0-9-]{1,64}$/.test(id)) continue;
    const stats = parseStats(row);
    if (stats) missions[id] = stats;
  }
  return { version: 1, missions };
}

export function parseTrainingRecord(raw: string | null): TrainingRecordV1 {
  if (!raw) return emptyTrainingRecord();
  try {
    return normalizeTrainingRecord(JSON.parse(raw) as unknown);
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
  const cleanRecord = normalizeTrainingRecord(record);
  if (!/^[a-z0-9-]{1,64}$/.test(session.missionId)) return cleanRecord;
  if (session.result !== "disarmed" && session.result !== "detonated") return cleanRecord;
  const previous = cleanRecord.missions[session.missionId] ?? emptyStats();
  const won = session.result === "disarmed";
  const sessionRating = VALID_RATINGS.has(session.rating) ? session.rating : "—";
  const sessionMsLeft = boundedMs(session.msLeft);
  const sessionStrikes = Math.min(3, boundedInteger(session.strikes, 3));
  const telemetry = session.telemetry ?? ({} as SessionTelemetry);
  const replaceRating = won && ratingRank(sessionRating) > ratingRank(previous.bestRating);
  const sessionHumanActions = boundedInteger(telemetry.humanActions);
  const humanActions = safeAdd(previous.humanActions, sessionHumanActions);
  const irreversibleConfirmations = Math.min(
    humanActions,
    safeAdd(
      previous.irreversibleConfirmations,
      Math.min(sessionHumanActions, boundedInteger(telemetry.irreversibleConfirmations))
    )
  );
  return {
    version: 1,
    missions: {
      ...cleanRecord.missions,
      [session.missionId]: {
        attempts: safeAdd(previous.attempts, 1),
        wins: safeAdd(previous.wins, won ? 1 : 0),
        cleanWins: safeAdd(previous.cleanWins, won && sessionStrikes === 0 ? 1 : 0),
        bestMsLeft: won ? Math.max(previous.bestMsLeft, sessionMsLeft) : previous.bestMsLeft,
        bestRating: replaceRating ? sessionRating : previous.bestRating,
        lastPlayedAt: timestamp(session.completedAt),
        agentReads: safeAdd(previous.agentReads, boundedInteger(telemetry.agentReads)),
        agentActuations: safeAdd(previous.agentActuations, boundedInteger(telemetry.agentActuations)),
        toolErrors: safeAdd(previous.toolErrors, boundedInteger(telemetry.toolErrors)),
        humanActions,
        irreversibleConfirmations
      }
    }
  };
}

export function saveCompletedSession(session: CompletedTrainingSession): TrainingRecordV1 {
  return saveCompletedSessionWithStatus(session).record;
}

export function saveCompletedSessionWithStatus(session: CompletedTrainingSession): TrainingSaveResult {
  const record = applyCompletedSession(loadTrainingRecord(), session);
  return { record, persisted: store.set(TRAINING_STORE_KEY, JSON.stringify(record)) };
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
