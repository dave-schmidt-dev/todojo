import type {
  McpUiDisplayMode,
  McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import type { TodojoBridge } from "./bridge.js";

/** Host-owned placement, independent from the widget's Full/Compact layout. */
export class DisplayModeControl {
  private context: McpUiHostContext = {};
  private pending = false;
  private feedback = "";
  private completed = false;
  private completionAttempted = false;
  private destroyed = false;
  private modeRevision = 0;
  private unlisten: (() => void) | undefined;

  constructor(
    private readonly bridge: TodojoBridge,
    private readonly changed: () => void,
  ) {}

  start(): void {
    this.unlisten = this.bridge.onHostContext?.((context) =>
      this.receive(context),
    );
    const context = this.bridge.getHostContext?.();
    if (context) this.receive(context);
  }

  destroy(): void {
    this.destroyed = true;
    this.unlisten?.();
  }

  updatePlan(completed: boolean): void {
    this.completed = completed;
    this.finish();
  }

  private receive(context: McpUiHostContext): void {
    if (this.destroyed) return;
    const previous = this.context.displayMode;
    this.context = { ...this.context, ...context };
    if (context.displayMode !== undefined) {
      this.modeRevision += 1;
      if (context.displayMode !== previous) this.feedback = "";
    }
    this.changed();
    this.finish();
  }

  private supports(mode: "inline" | "pip"): boolean {
    return Boolean(
      this.bridge.requestDisplayMode &&
        this.context.availableDisplayModes?.includes(mode),
    );
  }

  private get outsideChat(): boolean {
    return (
      this.context.displayMode === "pip" ||
      this.context.displayMode === "fullscreen"
    );
  }

  buttonHtml(): string {
    const target = this.outsideChat ? "inline" : "pip";
    const disabled =
      this.pending ||
      !this.supports(target) ||
      (this.completed && !this.outsideChat);
    const label = this.outsideChat ? "Return to chat" : "Keep visible";
    return `<button class="todojo__mode todojo__placement" data-placement aria-label="${label}" aria-describedby="todojo-display-status"${disabled ? " disabled" : ""}>${label}</button>`;
  }

  statusHtml(): string {
    const text =
      this.feedback ||
      (this.pending
        ? "Changing display mode…"
        : this.context.displayMode === "pip"
          ? "Kept visible by host."
          : this.context.displayMode === "fullscreen"
            ? "Shown fullscreen by host."
            : this.completed
              ? "Plan complete."
              : !this.supports("pip")
                ? "Keep visible unavailable in this host."
                : "");
    const unavailable =
      this.outsideChat && !this.supports("inline") && !this.pending;
    return `<div id="todojo-display-status" class="todojo__display-status" aria-live="polite" role="status">${text}${unavailable ? " Return to chat unavailable in this host." : ""}</div>`;
  }

  bind(root: HTMLElement): void {
    root.querySelector("[data-placement]")?.addEventListener("click", () => {
      if (!this.pending) void this.request(this.outsideChat ? "inline" : "pip");
    });
  }

  private finish(): void {
    if (
      !this.completed ||
      this.completionAttempted ||
      this.pending ||
      !this.outsideChat ||
      !this.supports("inline") ||
      this.destroyed
    )
      return;
    this.completionAttempted = true;
    void this.request("inline", true);
  }

  private async request(
    mode: "inline" | "pip",
    completion = false,
  ): Promise<void> {
    if (this.destroyed || this.pending || !this.supports(mode)) return;
    this.pending = true;
    this.feedback = completion
      ? "Plan complete. Returning to chat…"
      : mode === "pip"
        ? "Requesting to keep visible…"
        : "Returning to chat…";
    const revision = this.modeRevision;
    this.changed();
    try {
      const granted = await this.bridge.requestDisplayMode?.(mode);
      if (this.destroyed) return;
      // A later dismissal/context event outranks a delayed request response.
      if (this.modeRevision === revision && granted) {
        this.context.displayMode = granted;
        this.feedback = this.resultText(mode, granted, completion);
      } else this.feedback = "";
    } catch {
      if (!this.destroyed)
        this.feedback = completion
          ? "Plan complete. Unable to return to chat."
          : "Unable to change display mode.";
    } finally {
      this.pending = false;
      if (!this.destroyed) {
        this.changed();
        this.finish();
      }
    }
  }

  private resultText(
    requested: McpUiDisplayMode,
    actual: McpUiDisplayMode,
    completion: boolean,
  ): string {
    if (completion && actual !== "inline")
      return "Plan complete. Host kept ToDoJo visible.";
    if (actual === "pip") return "Kept visible by host.";
    if (actual === "fullscreen") return "Shown fullscreen by host.";
    return requested === "pip"
      ? "Host kept ToDoJo in chat."
      : "Returned to chat.";
  }
}
