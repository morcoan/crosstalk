import { describe, expect, it } from "vitest";
import { correctWireIndex, WIRE_COLORS, type WireColor } from "../src/game/modules/wires";
import { columnsContainingAll, glyph, KEYPAD_COLUMNS, uniqueToColumn } from "../src/game/modules/keypad";
import { ECHO_RULES } from "../src/game/modules/echo";
import { SIGNAL_TABLE } from "../src/game/modules/signal";
import { manualSection } from "../src/game/manual";
import { makeRng } from "../src/lib/rng";

/** Enumerate every wire layout for a given count. */
function allLayouts(n: number): WireColor[][] {
  let layouts: WireColor[][] = [[]];
  for (let i = 0; i < n; i++) {
    layouts = layouts.flatMap((l) => WIRE_COLORS.map((c) => [...l, c]));
  }
  return layouts;
}

describe("WIRE BAY rules", () => {
  it("always target an existing, in-range wire (exhaustive over all layouts)", () => {
    for (const n of [3, 4, 5]) {
      for (const layout of allLayouts(n)) {
        for (const odd of [true, false]) {
          const idx = correctWireIndex(layout, odd);
          expect(idx).toBeGreaterThanOrEqual(0);
          expect(idx).toBeLessThan(n);
        }
      }
    }
  });

  it("matches the documented rules on hand-checked cases", () => {
    // 3 wires, no red → second wire.
    expect(correctWireIndex(["blue", "yellow", "white"], true)).toBe(1);
    // 3 wires, red present, last white → last wire.
    expect(correctWireIndex(["red", "blue", "white"], false)).toBe(2);
    // 3 wires, red present, >1 blue → last blue.
    expect(correctWireIndex(["blue", "red", "blue"], false)).toBe(2);
    // 3 wires, fallthrough → first.
    expect(correctWireIndex(["red", "green", "black"], false)).toBe(0);
    // 4 wires, >1 yellow + odd serial → last yellow.
    expect(correctWireIndex(["yellow", "blue", "yellow", "black"], true)).toBe(2);
    // 4 wires, same but even serial → skips rule 1; has blue, one green? no → last wire.
    expect(correctWireIndex(["yellow", "blue", "yellow", "black"], false)).toBe(3);
    // 4 wires, no blue → first wire.
    expect(correctWireIndex(["red", "white", "yellow", "black"], false)).toBe(0);
    // 4 wires, blue present, exactly one green → the green wire.
    expect(correctWireIndex(["blue", "green", "white", "red"], false)).toBe(1);
    // 5 wires, last black + even serial → fourth wire.
    expect(correctWireIndex(["red", "blue", "white", "green", "black"], false)).toBe(3);
    // 5 wires, exactly one red + >1 green → the red wire.
    expect(correctWireIndex(["green", "red", "green", "white", "blue"], true)).toBe(1);
    // 5 wires, no yellow (and not the above) → second wire.
    expect(correctWireIndex(["white", "white", "blue", "green", "blue"], true)).toBe(1);
    // 5 wires, fallthrough → first wire.
    expect(correctWireIndex(["yellow", "white", "blue", "green", "white"], true)).toBe(0);
  });
});

describe("GLYPH KEYPAD columns", () => {
  it("every column has at least 2 unique glyphs (generation invariant)", () => {
    KEYPAD_COLUMNS.forEach((_, i) => {
      expect(uniqueToColumn(i).length).toBeGreaterThanOrEqual(2);
    });
  });

  it("any 4-glyph pick containing a unique glyph resolves to exactly one column", () => {
    for (let col = 0; col < KEYPAD_COLUMNS.length; col++) {
      const uniques = uniqueToColumn(col);
      for (const anchor of uniques) {
        const others = KEYPAD_COLUMNS[col].filter((g) => g !== anchor);
        // all 3-subsets of the remaining 5 glyphs
        for (let a = 0; a < others.length; a++)
          for (let b = a + 1; b < others.length; b++)
            for (let c = b + 1; c < others.length; c++) {
              const pick = [anchor, others[a], others[b], others[c]];
              expect(columnsContainingAll(pick)).toEqual([col]);
            }
      }
    }
  });
});

describe("ECHO CORE rules", () => {
  it("only reference earlier stages", () => {
    ECHO_RULES.forEach((rules, stageIdx) => {
      rules.forEach((rule) => {
        if (rule.type === "samePosition" || rule.type === "sameLabel") {
          expect(rule.stage).toBeGreaterThanOrEqual(1);
          expect(rule.stage).toBeLessThanOrEqual(stageIdx); // stage is 1-based; stageIdx 0-based
        }
      });
    });
  });

  it("has a rule for all 4 displays in all 4 stages", () => {
    expect(ECHO_RULES).toHaveLength(4);
    ECHO_RULES.forEach((rules) => expect(rules).toHaveLength(4));
  });
});

describe("SIGNAL TX table", () => {
  it("has 8 distinct patterns and 8 distinct frequencies", () => {
    expect(new Set(SIGNAL_TABLE.map((d) => d.pattern)).size).toBe(8);
    expect(new Set(SIGNAL_TABLE.map((d) => d.mhz)).size).toBe(8);
  });
  it("covers every short/long triple", () => {
    for (const a of ["short", "long"])
      for (const b of ["short", "long"])
        for (const c of ["short", "long"]) {
          expect(SIGNAL_TABLE.some((d) => d.pattern === `${a} ${b} ${c}`)).toBe(true);
        }
  });
});

describe("manual ↔ logic pact", () => {
  it("wires section documents the exact rule structure", () => {
    const text = manualSection("wires");
    expect(text).toContain("3 WIRES");
    expect(text).toContain("4 WIRES");
    expect(text).toContain("5 WIRES");
    expect(text).toContain("no RED wires → cut the SECOND wire");
    expect(text).toContain("more than one YELLOW wire and the serial digit is ODD");
    expect(text).toContain("LAST wire is BLACK and the serial digit is EVEN");
  });

  it("keypad section lists all three columns and every glyph char", () => {
    const text = manualSection("keypad");
    expect(text).toContain("COLUMN 1");
    expect(text).toContain("COLUMN 2");
    expect(text).toContain("COLUMN 3");
    for (const col of KEYPAD_COLUMNS) {
      for (const id of col) {
        const g = glyph(id);
        expect(text).toContain(g.char);
        expect(text).toContain(g.name);
      }
    }
  });

  it("signal section lists every detent", () => {
    const text = manualSection("signal");
    for (const d of SIGNAL_TABLE) {
      expect(text).toContain(d.mhz.toFixed(3));
      expect(text).toContain(d.pattern);
    }
  });

  it("echo section renders every stage rule", () => {
    const text = manualSection("echo");
    expect(text).toContain("STAGE 1");
    expect(text).toContain("STAGE 4");
    expect(text).toContain("SAME LABEL");
  });

  it("rejects unknown sections with a helpful error", () => {
    expect(() => manualSection("bogus")).toThrow(/Valid sections/);
  });
});

describe("seeded rng", () => {
  it("is deterministic for a given seed", () => {
    const a = makeRng(1234);
    const b = makeRng(1234);
    for (let i = 0; i < 50; i++) expect(a.next()).toBe(b.next());
  });
  it("int stays in range", () => {
    const r = makeRng(42);
    for (let i = 0; i < 1000; i++) {
      const v = r.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
    }
  });
});
