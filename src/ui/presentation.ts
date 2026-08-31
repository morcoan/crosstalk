import type { ModuleKind } from "../game/types";

type IconName = "link" | "eye" | "hand" | "radio" | "wrench" | "wire" | "gauge" | "signal" | "shield" | "menu";

const paths: Record<IconName, string> = {
  link: '<path d="M9.5 14.5l-2 2a3.5 3.5 0 01-5-5l3-3a3.5 3.5 0 015 0"/><path d="M14.5 9.5l2-2a3.5 3.5 0 015 5l-3 3a3.5 3.5 0 01-5 0"/><path d="M8 12h8"/>',
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/>',
  hand: '<path d="M7 12V7a1.5 1.5 0 013 0v3-5a1.5 1.5 0 013 0v5-4a1.5 1.5 0 013 0v5-2a1.5 1.5 0 013 0v5c0 4-2.5 7-6.5 7H10c-2.4 0-4.5-1.2-5.7-3.2L2.5 15a1.7 1.7 0 012.8-1.9L7 15"/>',
  radio: '<path d="M5 8h14v11H5z"/><path d="M8 8l7-4M8 12h4M8 15h6"/><circle cx="16.5" cy="14" r="1.5"/>',
  wrench: '<path d="M14.5 6.5a5 5 0 01-6.4 6.4L3 18l3 3 5.1-5.1a5 5 0 006.4-6.4l-3 3-3-3 3-3z"/>',
  wire: '<path d="M3 8h5l2 4 4-8 2 4h5M3 16h6l2-3 3 5 2-2h5"/>',
  gauge: '<path d="M4 18a8 8 0 1116 0"/><path d="M12 18l4-7"/><circle cx="12" cy="18" r="1.5"/>',
  signal: '<path d="M5 19a10 10 0 0114 0M8 16a6 6 0 018 0M11 13a2 2 0 012 0"/><circle cx="12" cy="20" r="1"/>',
  shield: '<path d="M12 2l8 3v6c0 5.2-3.2 9.1-8 11-4.8-1.9-8-5.8-8-11V5l8-3z"/><path d="M8 12l2.5 2.5L16 9"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>'
};

export function icon(name: IconName, className = "ui-icon"): string {
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
}

export const missionPresentation: Record<string, { threat: string; flavor: string; icon: IconName }> = {
  handshake: { threat: "TRAINING", flavor: "Learn the handoff", icon: "wire" },
  "crossed-wires": { threat: "FIELD", flavor: "Trade eyes for hands", icon: "gauge" },
  "silent-frequency": { threat: "HOSTILE", flavor: "Full-spectrum teamwork", icon: "signal" }
};

export const modulePresentation: Record<ModuleKind, { human: string; agent: string; instruction: string }> = {
  wires: {
    human: "See colors · cut wire",
    agent: "Scan serial · apply rules",
    instruction: "Read every wire color aloud, top to bottom. Cut only after your agent names the rule and wire."
  },
  keypad: {
    human: "See glyphs · press keys",
    agent: "Match the manual column",
    instruction: "Read the four glyph names aloud. Press them only in the order your agent gives you."
  },
  regulator: {
    human: "Read needle and green band",
    agent: "Move and lock the servo",
    instruction: "Call out the needle and green-zone numbers after every servo movement."
  },
  echo: {
    human: "Read display · press buttons",
    agent: "Track stages · resolve rule",
    instruction: "Say the display and all four button labels from left to right at every stage."
  },
  signal: {
    human: "Hear rhythm · transmit",
    agent: "Look up and tune frequency",
    instruction: "Listen for three short or long beeps, describe the rhythm, then wait for the dial to seat."
  }
};
