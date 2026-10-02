import type { DisplayProbeState } from "./display-probe.js";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

export function renderProbeControls(
  available: boolean,
  state: DisplayProbeState | undefined,
): { button: string; status: string } {
  if (!available && !state) return { button: "", status: "" };
  const isPip = state?.currentMode === "pip";
  const buttonLabel = isPip ? "Return inline" : "Try PiP";
  const buttonAction = isPip ? "return-inline" : "try-pip";
  const button = `<button class="todojo__mode todojo__probe-button" data-probe-action="${buttonAction}">${buttonLabel}</button>`;

  let statusText = "";
  const statusKind = state?.status ?? "idle";
  if (statusKind === "pending") {
    statusText = "PiP probe pending…";
  } else if (statusKind === "returned") {
    const outcome = state?.result?.outcome;
    const actual = state?.result?.actual;
    if (
      (outcome === "success" || actual === "pip") &&
      state?.currentMode === "pip"
    ) {
      statusText = "PiP active";
    } else if (
      (outcome === "success" || actual === "pip") &&
      state?.currentMode === "inline"
    ) {
      statusText = "PiP ended · inline";
    } else {
      statusText = `PiP returned ${actual ?? "inline"} (rejected)`;
    }
    if (state?.telemetryFailed) statusText += " (telemetry failed)";
  } else if (statusKind === "failure") {
    statusText =
      state?.result?.outcome === "timeout"
        ? "PiP request timed out"
        : "PiP request failed";
    if (state?.telemetryFailed) statusText += " (telemetry failed)";
  }

  const status = `<div class="todojo__probe-status" data-probe-status="${statusKind}" aria-live="polite">${escapeHtml(statusText)}</div>`;
  return { button, status };
}
