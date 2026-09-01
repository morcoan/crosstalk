# CROSSTALK v1.4.2 — UX, game-feel and handcrafted-art rationale

This pass deliberately preserved the mission rules. It changes how quickly a new player can form a
mental model, how clearly the game communicates ownership and state, and how much feedback each
action receives.

## Research translated into the interface

### Make competence and teamwork visible

Ryan, Rigby and Przybylski's four-study Self-Determination Theory research found that in-game
autonomy, competence and relatedness predict enjoyment and future play, while intuitive controls are
associated with competence and immersion. CROSSTALK's strongest need is relatedness: neither side has
the whole picture. v1.4 makes that partnership legible instead of leaving it implicit.

Applied here:

- every briefing and module has separate **YOU** and **AGENT** ownership plates;
- each module provides one concrete callout before the controls;
- the debrief turns completed actions into five named skill medals and a next drill;
- the mission record shows progress without adding currencies, streak pressure or invented rewards.

Source: [The Motivational Pull of Video Games: A Self-Determination Theory Approach](https://doi.org/10.1007/s11031-006-9051-8)

### Design backward from the desired feeling

The MDA framework separates mechanics, runtime dynamics and the emotional experience. The unchanged
mechanic is asymmetric information. The desired dynamics are rapid callouts, verification and shared
commitment; the desired aesthetics are fellowship, challenge and tension. UI elements were retained
only when they reinforce that chain.

Applied here:

- menu onboarding is the real play loop: **observe → communicate → commit**;
- mission cards promise a cooperation pattern rather than listing technical features;
- the timer and strike bank read as physical instruments, keeping time pressure present;
- technical connection details are still available, but disclosed beneath the player-facing pitch.

Source: [MDA: A Formal Approach to Game Design and Game Research](https://www.cs.northwestern.edu/~hunicke/MDA.pdf)

### Amplify action feedback, remove decorative noise

Game-feel research describes “juicing” as feedback amplification that communicates the importance of
events, and streamlining as letting the game act on player intention. v1.4 uses small, semantic
responses rather than constant ambient animation.

Applied here:

- separate synthesized sounds acknowledge arm, radio, servo and physical-control events;
- TEAM RADIO promotes the newest event and collapses older transmissions into history;
- solved/armed status, LEDs and physical depression states respond immediately;
- reduced-motion mode removes pulses, transitions and decorative movement.

Source: [Designing Game Feel: A Survey](https://arxiv.org/abs/2011.09201)

### Build a place, not a component library

The earlier pass made the hierarchy clearer, but too many equally rounded panels still read as a
generated interface. v1.4 gives each surface an object identity and a reason to exist. The hierarchy
is carried by material, placement and wear: paper is for instructions, manila and blueprint stock are
for missions, painted metal is for equipment, and thermal paper is for live radio output.

Applied here:

- the landing page is an asymmetric workbench scene, not a centered dashboard;
- mission choices are three differently sized and differently surfaced case files;
- modules share one enclosing chassis, so the device reads as a prop rather than a grid of widgets;
- the briefing and debrief reuse familiar physical forms—a docket and clipboard—so their purpose is
  understood before the text is read;
- controlled imperfections (tape, clips, punch holes, rivets, pencil marks and slight rotation) are
  authored selectively instead of randomized across every element;
- local condensed, technical and handwritten typefaces supply distinct voices without runtime font
  requests; licenses and original artwork provenance are recorded in `CREDITS.md`.

### Make the critical path operable at a glance

WCAG 2.2 requires at least 24×24 CSS-pixel targets under its minimum target-size criterion. Xbox's
game accessibility guidance recommends larger, well-spaced touch areas and alternate input paths.
CROSSTALK uses a stricter project floor: 42px on desktop and 44px on mobile, plus keyboard activation.

Applied here:

- automated checks cover minimum visible target sizes at 1440px, 390px and 320px;
- no horizontal overflow at either small-screen width;
- the countdown remains sticky below the compact mobile header;
- the mobile utility menu exposes `aria-expanded`, and the mission path works by keyboard;
- color names and glyph names are printed beside visual forms, not encoded by color alone.

Sources: [WCAG 2.2 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), [Xbox Accessibility Guideline 107: Input](https://learn.microsoft.com/en-us/gaming/accessibility/xbox-accessibility-guidelines/107)

## Verification

`npm run ux` is a repeatable Playwright gate for the assertions above. It complements the gameplay
tests: `npm test`, `npm run smoke` and `npm run native` prove rules and tool behavior; the UX gate
proves the critical interaction remains understandable and usable across the supported layouts.

## v1.4.2 tactile-thriller refinement

The follow-up keeps the research-backed hierarchy but removes the remaining repeated panel rhythm.
Each mission now carries a diagram tied to its cooperation pattern; the briefing is presented as an
ordered preflight; live modules expose persistent wayfinding and distinct instrument housings; and
the two technical drawers behave like different pieces of issued equipment. On mobile, a keyboard-
operable snap tray keeps every case file available without forcing players through three full-height
cards before they can review the play loop.

The new presentation remains semantic rather than ornamental: the module strip mirrors real
armed/cleared state, the compact radio ticker mirrors the authoritative feed without duplicating its
live announcement, and solved modules stay mounted to avoid focus and layout jumps. The expanded UX
gate verifies those contracts at desktop, 390px and 320px alongside Axe, forced colors, reduced
motion, exact overflow, touch targets and modal focus containment.
