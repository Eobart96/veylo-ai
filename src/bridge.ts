import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Direction } from "./state";
import type { Region } from "./screen-region";

export interface CaptureStatus {
  phase: "idle" | "freezing" | "selecting" | "recognizing" | "translating" | "result" | "error";
  busy?: boolean; generation?: number; region?: Region | null; translated?: string | null; error: string | null;
  blocks?: { region: Region; source: string; translation: string }[];
}
export async function getFrozenFrame(): Promise<{ generation: number; image: string } | null> { return invoke("screen_capture_frame"); }
export async function startScreenCapture(fullScreen = false): Promise<void> { await invoke("start_screen_capture", { fullScreen }); }
export async function startCursorLine(): Promise<void> { await invoke("start_cursor_line"); }
export async function finishScreenCapture(region: Region, generation: number): Promise<void> { await invoke("finish_screen_capture", { region, generation }); }
export async function cancelScreenCapture(): Promise<void> { await invoke("cancel_screen_capture"); }
export async function observeCapture(update: (status: CaptureStatus) => void): Promise<void> {
  if (!native) return;
  await listen<CaptureStatus>("screen-capture-state", event => update(event.payload));
  update(await invoke<CaptureStatus>("screen_capture_status"));
}
export async function observeScreenText(update: (result: { source: string; sourceTruncated?: boolean; translation: Translation }) => void): Promise<void> {
  if (native) await listen<{ source: string; sourceTruncated?: boolean; translation: Translation }>("screen-result", event => update(event.payload));
}

export interface Translation { text: string; direction: Direction; elapsedMs: number; }
export async function translateText(text: string, direction: Direction): Promise<Translation> {
  if (!native) throw new Error("Перевод работает в приложении Veylo AI, а не в браузерном предпросмотре.");
  return invoke<Translation>("translate_text", { text, direction });
}

export interface AppStatus {
  version: string; platform: string; shortcutRegistered: boolean; shortcutPending: boolean; shortcut: string;
  shortcutError: string | null; aiConnected: boolean;
  captureAvailable: boolean; embeddedBrowserAvailable: boolean;
  captureShortcutRegistered: boolean; captureShortcut: string;
  cursorShortcutRegistered: boolean; cursorShortcut: string;
}
export const native = isTauri();
export async function setOverlay(overlay: boolean): Promise<OverlayView> {
  if (!native) throw new Error("Оверлей доступен в приложении Windows.");
  return invoke<OverlayView>("set_overlay", { overlay });
}
export interface OverlayView { pinned: boolean; visible: boolean; editing: boolean; width: number; height: number; saveError: string | null; ready: boolean; openError: string | null }
export async function dismissOverlay(): Promise<void> { if (native) await invoke("dismiss_overlay"); }
export async function reportBackdropStyles(checks: { transparentBase: boolean; hudStyled: boolean; gradients: boolean }): Promise<void> {
  if (native) await invoke("backdrop_style_ready", checks);
}
export function currentWindowLabel(): string | undefined { return native ? getCurrentWindow().label : undefined; }
export async function reportFrontendReady(role: string): Promise<void> { if (native) await invoke("frontend_ready", { role }); }
export async function openOverlayCentered(): Promise<OverlayView> {
  if (!native) throw new Error("Оверлей доступен в приложении Windows.");
  return invoke<OverlayView>("open_overlay_centered");
}
export async function getOverlayView(): Promise<OverlayView | null> { return native ? invoke<OverlayView>("overlay_view") : null; }
export async function setPanelSize(width: number, height: number): Promise<void> { if (native) await invoke("set_panel_size", { width, height }); }
export async function resetPanelPosition(): Promise<void> { if (native) await invoke("reset_panel_position"); }
export type ResizeDirection = Parameters<ReturnType<typeof getCurrentWindow>["startResizeDragging"]>[0];
export async function resizePanel(direction: ResizeDirection = "SouthEast"): Promise<void> { if (native) await getCurrentWindow().startResizeDragging(direction); }
export async function showMain(): Promise<void> { if (native) await invoke("show_main"); }
export interface TranslationSnapshot {
  revision: number; busy: boolean;
  entries: ({ source: string; translation: Translation | null; error: string | null } | null)[];
}
export async function observeTranslations(update: (state: TranslationSnapshot) => void): Promise<void> {
  if (!native) return;
  await listen<TranslationSnapshot>("translation-state", event => update(event.payload));
  update(await invoke<TranslationSnapshot>("translation_snapshot"));
}
export async function observeOverlay(update: (view: OverlayView) => void): Promise<void> {
  if (!native) return;
  await listen<OverlayView>("overlay-mode", event => update(event.payload));
  update(await invoke<OverlayView>("overlay_view"));
}

export async function getStatus(): Promise<AppStatus | null> {
  return native ? invoke<AppStatus>("get_app_status") : null;
}
export async function observeStatus(update: (status: AppStatus) => void): Promise<void> {
  if (!native) return;
  await listen<AppStatus>("app-status", event => update(event.payload));
  const status = await getStatus();
  if (status) update(status);
}
export async function setPinned(pinned: boolean): Promise<void> {
  if (!native) throw new Error("Закрепление доступно в программе Windows.");
  await invoke("set_pinned", { pinned });
}
export async function dragPanel(): Promise<void> { if (native) await invoke("drag_panel"); }
export async function hideOverlay(): Promise<void> {
  if (native) await invoke("hide_overlay");
}
export async function copyText(text: string): Promise<void> {
  if (!text.trim()) throw new Error("Сначала введи текст.");
  if (native) await invoke("copy_text", { text });
  else await navigator.clipboard.writeText(text);
}
