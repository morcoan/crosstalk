# Devpost Submission — CROSSTALK

> Copy-paste material for the Devpost form. Trim to taste.

## Project name

**CROSSTALK — a co-op defusal game where the second player is your AI agent**

## Elevator pitch (tagline)

You see the bomb. Your agent holds the manual — as live WebMCP tools. Neither of you can defuse it alone.

## About the project (main description)

### Inspiration

Every agentic demo we'd seen treats the agent as a chauffeur: it drives, you watch. We wanted to
build the opposite — an experience that is *impossible alone by design*, where a human and their
agent are genuine teammates with different senses and different hands. The classic party game
*Keep Talking and Nobody Explodes* proved that "split knowledge + a ticking clock" makes people
talk to each other. CROSSTALK asks: what happens when the *other player* is your AI agent, and the
split isn't a paper manual — it's the tool boundary itself?

### What it does

CROSSTALK puts a bomb on your screen: a countdown, a strike counter, and up to four modules —
colored wires, a glyph keypad, an analog voltage regulator, a memory core, a beeping transmitter.

- **The human** sees and touches everything: paint colors, squiggly glyphs, gauge needles, display
  digits, audio beeps. Only the human can cut wires, press keys, and hit TRANSMIT.
- **The agent** knows and actuates through WebMCP tools: the searchable technical manual
  (`consult_manual`), the RFID serial scanner (`scan_data_tag`), a flight recorder
  (`get_echo_log`), and servo actuators (`nudge_regulator`, `lock_regulator`,
  `set_transmitter_frequency`) for the dials human hands can't turn.

Every module is a deliberately engineered *asymmetry*. The regulator inverts the usual relationship:
only the agent can move the dial, but its gauge sensor is "burned out" — only the human can read
the needle. You get a closed feedback loop of servo nudges and shouted needle readings with a timer
screaming in the background. Three strikes or zero seconds: boom.

Three missions escalate from a 1-module trainer to a 4-module device. There's a printed-manual SOLO
mode, an in-page WebMCP tool console (invoke everything an agent could, no agent required), a live
activity feed that narrates every tool call your agent makes, synthesized audio, seeded devices for
replayability, and a declarative-API field report form on the debrief screen.

### Why this use case is a strong fit for WebMCP

1. **A tool schema is a sensory boundary.** WebMCP's core act — deciding exactly what an agent can
   see and do on your page — is usually plumbing. CROSSTALK makes it the game mechanic. The rules
   live *only* in tools; the pixels live *only* on screen. The standard isn't decorating the app;
   it IS the app.
2. **It must be client-side.** The bomb is ephemeral, seeded, running at 60fps in the browser with
   WebAudio and a real-time drift simulation. There is no backend to put an MCP server in front of —
   shared live state between human, page and agent is exactly the gap WebMCP exists to fill.
3. **It exercises the whole spec, honestly.** Nine imperative tools with JSON Schemas and
   `readOnlyHint` annotations; per-tool `AbortController` lifecycles so the toolset mirrors game
   state in real time (solve the regulator mid-sentence and its tools vanish from `getTools()`,
   firing `toolchange`); instructive error returns; plus the declarative API
   (`<form toolname="file_field_report" toolautosubmit>` with `agentInvoked`/`respondWith`).

### What people + agents can do together that they couldn't before

Play a real-time cooperative game as *peers*. Before WebMCP, an in-browser agent could only watch
the DOM over your shoulder or click things for you — with no way for the page to give it different
senses than yours. CROSSTALK's whole premise — "you can hear the beeps, your agent can turn the
dial" — was unbuildable. More practically: the game is an unintentional trainer for the skills
everyone will need this decade — delegating to an agent, describing what you see precisely,
verifying before acting irreversibly, and trusting a teammate whose work you can see narrated in a
feed. People learn tools through play; CROSSTALK is agent literacy with a countdown timer.

### How we built it

- Vite + TypeScript, **zero runtime dependencies** (~20 KB gzipped). All client-side, no accounts.
- A tiny event bus decouples three layers: game core (seeded missions, five module state machines),
  WebMCP layer (a `document.modelContext` adapter with per-tool abort lifecycles and an owner-diffing
  reconciler), and UI (device board, activity feed, tool console, printed manual).
- The manual text and module logic are generated from the same data structures, so the agent's
  rules can never drift from the device's behavior — enforced by 15 unit tests.
- Three verification layers: unit tests; a headless-Chromium smoke run that plays all three missions
  to zero-strike disarms using only tool text + DOM (it transcribes the beep pattern by watching the
  speaker LED); and a native run against Chromium's real WebMCP implementation
  (`--enable-features=WebMCPTesting`) proving registration, `executeTool`, `toolchange`, and the
  declarative form all work on the actual API.

### Challenges

- **Designing for the agent's blind spots.** Early playtests showed models guessing instead of
  asking. The fix was sensory honesty in tool text: `get_device_state` explicitly marks every
  channel as "NOT machine-readable — ask your partner," which reliably flips models from
  hallucinating to collaborating.
- **Tool lifecycles.** WebMCP has no `unregisterTool` — we built the toolset as a reconciled,
  owner-diffed set of `AbortController`s so tools track game state without churn.
- **Trust.** Humans get nervous when an invisible teammate has servos. The activity feed narrates
  every tool call the moment it happens — transparency as a game feature.

### What's next

Head-to-head mode (two humans, two agents, same seed), a community module SDK (a module = one
asymmetry + one manual section + one tool bundle), and a difficulty tier where the manual is only
exposed through rate-limited tools.

## Built with

TypeScript, Vite, WebMCP (imperative + declarative APIs), WebAudio, SVG, Playwright, Vitest,
GitHub Pages.

## Try it out

- Live: https://morcoan.github.io/crosstalk/
- Repo: https://github.com/morcoan/crosstalk

## New vs. pre-existing work

CROSSTALK is a **new project, built entirely within the submission period** (first commit
August 25, 2026, after the window opened). The full, timestamped commit history is public in the
repository — game engine, all five modules, the WebMCP layer, tests, docs and video tooling were
all created during the hackathon. No pre-existing code was extended.

## Testing notes for judges

1. Open the live URL in ChatGPT's in-app browser, or Chrome 149+ with
   `chrome://flags/#enable-webmcp-testing` enabled.
2. The menu shows **AGENT LINK ESTABLISHED** when WebMCP is detected. Click **COPY OPENER** and
   paste it to your agent — or just ask: *"check your tools and get the briefing."*
3. Start with mission 1 (HANDSHAKE, one wire bay) — a clean 2-minute demo of the loop. Mission 3
   (SILENT FREQUENCY) shows all five asymmetries including the audio module.
4. No agent? Click **TOOLS** (top right): every live WebMCP tool is listed and invokable in-page
   through the identical execute path. **MANUAL** opens the printed manual for solo play.
5. Prompts that show the design fast: *“What can you sense on this device — and what do you need
   me for?”* · *“Start mission 2 and walk me through it, never guess.”* · after a win: *“File our
   field report — callsign WIRE WOLVES”* (exercises the declarative form tool).
