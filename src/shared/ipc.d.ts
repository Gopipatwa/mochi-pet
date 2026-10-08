/**
 * The complete IPC contract between the Rust app and the two web pages. `ipc_invoke` / `ipc_send` in
 * src-tauri/src/main.rs implement it and reject anything else; src/renderer/shared/bridge.js exposes it
 * to the pages as `window.api`. (Types only, there is no build step.)
 */

export type Speech = {
  id: string;
  kind: 'greeting' | 'reminder' | 'meeting' | 'info';
  text: string;
  /** Seconds before the bubble disappears on its own. */
  ttl: number;
  actions: Array<'done' | 'snooze'>;
  sound: boolean;
};

export type Frame = {
  /** Cursor position relative to the pet window (DIPs). */
  cx: number;
  cy: number;
  /** Pet velocity in DIPs per second. */
  vx: number;
  vy: number;
  walking: boolean;
  dragging: boolean;
  /** True while he is ducked behind a window edge, peeking over it. */
  peek: boolean;
};

export type Runtime = {
  paused: boolean;
  dnd: boolean;
  fullscreen: boolean;
  sleeping: boolean;
  petVisible: boolean;
  version: string;
  packaged: boolean;
};

export type BubbleAction = { id: string; action: 'done' | 'snooze' | 'dismiss' };

/** renderer -> main, request/response */
export interface InvokeChannels {
  'app:get-state': { args: []; result: { settings: unknown; runtime: Runtime } };
  'settings:patch': { args: [partial: Record<string, unknown>]; result: unknown };
  'settings:reset': { args: []; result: unknown };
  'settings:export': { args: []; result: { ok: boolean; path?: string } };
  'settings:import': { args: []; result: { ok: boolean; error?: string } };
  'meetings:upcoming': { args: []; result: Array<{ title: string; at: number; source: 'manual' | 'calendar' }> };
  'meetings:pick-ics': { args: []; result: { ok: boolean; path?: string; count?: number } };
  'meetings:clear-ics': { args: []; result: { ok: boolean } };
  'test:fire': { args: [kind: 'reminder' | 'meeting' | 'greeting' | 'tease']; result: void };
}

/** renderer -> main, fire and forget */
export interface SendChannels {
  'pet:ready': [];
  'pet:drag-start': [];
  'pet:drag-end': [];
  'pet:ignore-mouse': [ignore: boolean];
  'pet:context-menu': [];
  'pet:bubble-action': [BubbleAction];
  'app:open-settings': [tab?: string];
  'app:toggle': [what: 'dnd' | 'paused'];
  /** The main pet tells the buddy what happened to it (it reacts). */
  'pet:emote': [kind: 'click' | 'dizzy' | 'giggle'];
}

/** main -> renderer */
export interface EventChannels {
  'settings:changed': { settings: unknown; origin: string };
  'runtime:changed': Runtime;
  'pet:speak': Speech;
  'pet:frame': Frame;
  'pet:landed': { impact: number };
  'pet:dismiss': { id: string };
  /** Playful moment for the main pet (tongue out). */
  'pet:tease': { kind: 'tongue' };
  /** Delivered to the buddy window only. */
  'pet:friend': { kind: string };
}
