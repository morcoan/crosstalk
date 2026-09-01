import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MISSIONS,
  armDevice,
  backToMenu,
  detonationTransitionPending,
  game,
  goToBriefing,
  syncMissionClock
} from "../src/game/state";

describe("mission ownership and fuse reliability", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T12:00:00.000Z"));
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("document", { body: { classList: { toggle: vi.fn() } } });
    backToMenu();
  });

  afterEach(() => {
    backToMenu();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("uses an absolute, monotonic wall-clock deadline and blocks arming during the boom", () => {
    const startedAt = Date.now();
    armDevice(MISSIONS[0]);
    expect(game.device?.msLeft).toBe(300_000);

    expect(syncMissionClock(startedAt + 3_500)).toBe(296_500);
    expect(syncMissionClock(startedAt + 1_000)).toBe(296_500);

    expect(syncMissionClock(startedAt + 300_000)).toBe(0);
    expect(game.device?.result).toBe("detonated");
    expect(detonationTransitionPending()).toBe(true);
    expect(() => goToBriefing("crossed-wires")).toThrow(/detonation sequence/i);
    expect(() => armDevice(MISSIONS[1])).toThrow(/detonation sequence/i);
  });

  it("does not let a detonation callback overwrite a newer screen", async () => {
    const startedAt = Date.now();
    armDevice(MISSIONS[0]);
    syncMissionClock(startedAt + 300_000);

    // Simulate navigation winning the race before the queued transition fires.
    game.screen = "briefing";
    game.briefingMission = MISSIONS[1];
    await vi.advanceTimersByTimeAsync(1_400);

    expect(game.screen).toBe("briefing");
    expect(game.briefingMission).toBe(MISSIONS[1]);
  });

  it("rejects module tools captured from an older device session", async () => {
    armDevice(MISSIONS[1]);
    const oldDevice = game.device!;
    const regulator = oldDevice.modules.find((module) => module.kind === "regulator")!;
    const staleLock = regulator.tools().find((tool) => tool.name === "lock_regulator")!;

    backToMenu();
    armDevice(MISSIONS[0]);
    const currentDevice = game.device!;
    const strikes = currentDevice.strikes;
    const feedLength = game.feed.length;

    expect(() => staleLock.execute({})).toThrow(/expired device session/i);
    expect(currentDevice.sessionId).not.toBe(oldDevice.sessionId);
    expect(game.device).toBe(currentDevice);
    expect(currentDevice.strikes).toBe(strikes);
    expect(game.feed).toHaveLength(feedLength);
  });
});
