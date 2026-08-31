import { describe, expect, it } from "vitest";
import {
  applyCompletedSession,
  emptyTrainingRecord,
  parseTrainingRecord,
  recommendMission,
  trainingTotals,
  type CompletedTrainingSession
} from "../src/game/training";

const missions = [
  { id: "handshake", codename: "HANDSHAKE" },
  { id: "crossed-wires", codename: "CROSSED WIRES" },
  { id: "silent-frequency", codename: "SILENT FREQUENCY" }
];

function session(overrides: Partial<CompletedTrainingSession> = {}): CompletedTrainingSession {
  return {
    missionId: "handshake",
    result: "disarmed",
    msLeft: 240_000,
    strikes: 0,
    rating: "S — FLAWLESS CROSSTALK",
    completedAt: 100,
    telemetry: {
      agentReads: 3,
      agentActuations: 1,
      toolErrors: 0,
      humanActions: 2,
      irreversibleConfirmations: 1,
      toolUsage: { consult_manual: 1 }
    },
    ...overrides
  };
}

describe("local operator dossier", () => {
  it("fails closed to an empty v1 record for missing, corrupt, or future data", () => {
    expect(parseTrainingRecord(null)).toEqual(emptyTrainingRecord());
    expect(parseTrainingRecord("not json")).toEqual(emptyTrainingRecord());
    expect(parseTrainingRecord('{"version":2,"missions":{}}')).toEqual(emptyTrainingRecord());
  });

  it("records wins, losses, clean clears, best result, and observable totals", () => {
    let record = applyCompletedSession(emptyTrainingRecord(), session());
    record = applyCompletedSession(
      record,
      session({ result: "detonated", msLeft: 0, strikes: 3, rating: "—", completedAt: 200 })
    );
    record = applyCompletedSession(
      record,
      session({ msLeft: 120_000, strikes: 1, rating: "B — SINGED", completedAt: 300 })
    );
    const row = record.missions.handshake;
    expect(row).toMatchObject({
      attempts: 3,
      wins: 2,
      cleanWins: 1,
      bestMsLeft: 240_000,
      bestRating: "S — FLAWLESS CROSSTALK",
      lastPlayedAt: 300,
      agentReads: 9,
      agentActuations: 3,
      humanActions: 6,
      irreversibleConfirmations: 3
    });
    expect(trainingTotals(record, missions)).toMatchObject({ completed: 1, attempts: 3, wins: 2, cleanWins: 1 });
  });

  it("recommends the first uncleared drill, then the weakest/oldest completed drill", () => {
    let record = emptyTrainingRecord();
    expect(recommendMission(record, missions).id).toBe("handshake");
    record = applyCompletedSession(record, session());
    expect(recommendMission(record, missions).id).toBe("crossed-wires");
    record = applyCompletedSession(
      record,
      session({ missionId: "crossed-wires", rating: "A — CLEAN HANDS", completedAt: 200 })
    );
    record = applyCompletedSession(
      record,
      session({ missionId: "silent-frequency", rating: "B — SINGED", strikes: 1, completedAt: 300 })
    );
    expect(recommendMission(record, missions).id).toBe("silent-frequency");
  });
});
