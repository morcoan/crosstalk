import { afterEach, describe, expect, it, vi } from "vitest";
import { parseTrainingRecord } from "../src/game/training";
import { parseBestRecord } from "../src/game/state";
import { parseStoredArray, store } from "../src/lib/dom";

describe("strict local persistence", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fails closed on invalid training shapes and normalizes hostile counters", () => {
    expect(parseTrainingRecord("[]")).toEqual({ version: 1, missions: {} });
    expect(parseTrainingRecord('{"version":999,"missions":{}}')).toEqual({ version: 1, missions: {} });

    const record = parseTrainingRecord(JSON.stringify({
      version: 1,
      missions: {
        handshake: {
          attempts: 2,
          wins: 99,
          cleanWins: 99,
          bestMsLeft: 100.9,
          bestRating: "S<script>",
          lastPlayedAt: -5,
          agentReads: 1.5,
          agentActuations: 1_000_000_001,
          toolErrors: 3,
          humanActions: 4,
          irreversibleConfirmations: 5
        },
        "not valid!": { attempts: 10 }
      }
    }));

    expect(record.missions).toEqual({
      handshake: {
        attempts: 2,
        wins: 2,
        cleanWins: 2,
        bestMsLeft: 100,
        bestRating: "—",
        lastPlayedAt: 0,
        agentReads: 0,
        agentActuations: 0,
        toolErrors: 3,
        humanActions: 4,
        irreversibleConfirmations: 4
      }
    });
  });

  it("rejects malformed best records and bounds report-adjacent arrays", () => {
    expect(parseBestRecord("null", 300_000)).toBeNull();
    expect(parseBestRecord('{"msLeft":1.5,"strikes":0,"when":1}', 300_000)).toBeNull();
    expect(parseBestRecord('{"msLeft":300001,"strikes":0,"when":1}', 300_000)).toBeNull();
    expect(parseBestRecord('{"msLeft":200000,"strikes":3,"when":1}', 300_000)).toBeNull();
    expect(parseBestRecord('{"msLeft":200000,"strikes":1,"when":1}', 300_000)).toEqual({
      msLeft: 200_000,
      strikes: 1,
      when: 1
    });

    const accepted = parseStoredArray(
      '[{"id":1},{"id":"bad"},{"id":2},{"id":3}]',
      (value) => {
        const row = value as { id?: unknown };
        return Number.isSafeInteger(row?.id) ? { id: row.id as number } : null;
      },
      2
    );
    expect(accepted).toEqual([{ id: 1 }, { id: 2 }]);
    expect(parseStoredArray("{}", () => "never", 5)).toEqual([]);
    expect(parseStoredArray("[1]", () => 1, 0)).toEqual([]);
  });

  it("reports storage writes and keeps every audio path non-throwing", async () => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { getItem: vi.fn(() => null), setItem });
    expect(store.set("key", "value")).toBe(true);
    expect(setItem).toHaveBeenCalledWith("key", "value");

    setItem.mockImplementation(() => {
      throw new Error("quota denied");
    });
    expect(store.set("key", "value")).toBe(false);

    class BrokenAudioContext {
      state = "running";
      currentTime = 0;
      sampleRate = 44_100;
      createOscillator(): never {
        throw new Error("output device removed");
      }
      createBuffer(): never {
        throw new Error("output device removed");
      }
    }
    vi.stubGlobal("AudioContext", BrokenAudioContext);
    vi.resetModules();
    const { setMuted, sfx, unlock } = await import("../src/lib/audio");

    expect(() => setMuted(false)).not.toThrow();
    expect(() => unlock()).not.toThrow();
    expect(() => sfx.arm()).not.toThrow();
    expect(() => sfx.radio()).not.toThrow();
    expect(() => sfx.servo()).not.toThrow();
    expect(() => sfx.strike()).not.toThrow();
    expect(() => sfx.win()).not.toThrow();
    expect(() => sfx.boom()).not.toThrow();
  });
});
