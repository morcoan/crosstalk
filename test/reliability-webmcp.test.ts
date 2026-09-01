import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolSpec } from "../src/game/types";
import {
  liveTools,
  resetWebMcpForTests,
  syncTools,
  webmcpHealth
} from "../src/webmcp/context";

interface CapturedRegistration {
  execute(input: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<string>;
}

function tool(execute: ToolSpec["execute"]): ToolSpec {
  return {
    name: "reliability_probe",
    title: "Reliability probe",
    description: "Test-only probe.",
    inputSchema: { type: "object", properties: {} },
    readOnly: true,
    execute
  };
}

function installDocument(modelContext: unknown): EventTarget & { modelContext: unknown } {
  const doc = new EventTarget() as EventTarget & { modelContext: unknown };
  doc.modelContext = modelContext;
  vi.stubGlobal("document", doc);
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("window", new EventTarget());
  return doc;
}

async function settleRegistration(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("WebMCP registration reliability", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetWebMcpForTests();
  });

  afterEach(() => {
    resetWebMcpForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("catches asynchronous registration failures, retries finitely, and keeps the local tool", async () => {
    installDocument({ registerTool: vi.fn().mockRejectedValue(new Error("host rejected registration")) });
    const spec = tool(() => "local result");

    syncTools([{ spec, owner: {} }]);
    await vi.runAllTimersAsync();

    expect(liveTools()).toEqual([spec]);
    expect(webmcpHealth()).toMatchObject({
      available: true,
      mode: "degraded",
      desired: 1,
      ready: 0,
      registering: 0,
      failed: 1
    });
    expect(webmcpHealth().failures).toEqual([
      expect.objectContaining({ name: spec.name, attempts: 4, message: "host rejected registration" })
    ]);
  });

  it("detects late and replacement contexts and truthfully re-registers", async () => {
    const firstRegister = vi.fn();
    const secondRegister = vi.fn();
    const doc = installDocument(null);
    const spec = tool(() => "ok");

    syncTools([{ spec, owner: {} }]);
    expect(webmcpHealth()).toMatchObject({ mode: "local-only", desired: 1, ready: 0 });

    // Install after all short startup probes have elapsed; the low-frequency
    // absent-context monitor must still discover it without a manual refresh.
    await vi.advanceTimersByTimeAsync(2_700);
    doc.modelContext = { registerTool: firstRegister };
    await vi.advanceTimersByTimeAsync(1_300);
    await settleRegistration();
    expect(firstRegister).toHaveBeenCalledTimes(1);
    expect(webmcpHealth()).toMatchObject({ mode: "ready", contextVersion: 1, ready: 1 });

    doc.modelContext = { registerTool: secondRegister };
    (globalThis.window as EventTarget).dispatchEvent(new Event("focus"));
    await settleRegistration();
    expect(secondRegister).toHaveBeenCalledTimes(1);
    expect(webmcpHealth()).toMatchObject({ mode: "ready", contextVersion: 2, ready: 1 });
  });

  it("retires in-flight registrations only after completion and rejects stale handles", async () => {
    let captured: CapturedRegistration | null = null;
    let registrationSignal: AbortSignal | undefined;
    installDocument({
      registerTool: vi.fn((registration: CapturedRegistration, options?: { signal?: AbortSignal }) => {
        captured = registration;
        registrationSignal = options?.signal;
      })
    });
    let release!: (value: string) => void;
    const pending = new Promise<string>((resolve) => {
      release = resolve;
    });
    const execute = vi.fn(() => pending);
    const spec = tool(execute);

    syncTools([{ spec, owner: {} }]);
    await settleRegistration();
    expect(captured).not.toBeNull();
    const registration = captured!;

    const invocation = registration.execute({});
    await settleRegistration();
    expect(execute).toHaveBeenCalledTimes(1);
    syncTools([]);
    expect(webmcpHealth()).toMatchObject({ desired: 0, retiring: 1 });
    expect(registrationSignal?.aborted).toBe(false);

    release("settled result");
    await expect(invocation).resolves.toBe("settled result");
    await vi.advanceTimersByTimeAsync(0);
    expect(registrationSignal?.aborted).toBe(true);
    expect(webmcpHealth().retiring).toBe(0);

    await expect(registration.execute({})).resolves.toMatch(/expired with its device state/i);
    expect(execute).toHaveBeenCalledTimes(1);

    const cancelled = new AbortController();
    cancelled.abort();
    await expect(registration.execute({}, { signal: cancelled.signal })).resolves.toMatch(/expired|cancelled/i);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
