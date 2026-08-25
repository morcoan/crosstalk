import "./styles.css";
import { on } from "./lib/bus";
import { installWebMcp } from "./webmcp/tools";
import { mountHud } from "./ui/hud";
import { renderScreen } from "./ui/screens";

/**
 * CROSSTALK — a cooperative defusal game for one human and one AI agent.
 * The human plays the screen; the agent plays through WebMCP tools.
 */

const app = document.getElementById("app")!;

mountHud(app);

const screenHost = document.createElement("main");
screenHost.id = "screen-host";
app.appendChild(screenHost);

// Scanline / vignette overlay + boom flash layer.
const fx = document.createElement("div");
fx.className = "fx-overlay";
app.appendChild(fx);
const boom = document.createElement("div");
boom.className = "boom-overlay";
app.appendChild(boom);

on("screen", () => renderScreen(screenHost));
renderScreen(screenHost);

// Register WebMCP tools last so first paint is instant.
installWebMcp();
