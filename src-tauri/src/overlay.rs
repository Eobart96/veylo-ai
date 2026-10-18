//! Compact translator plus a dim layer during interactive overlay mode.
use crate::{preferences::{self, Preferences}, window_focus as focus};
use serde::Serialize;
use std::{path::PathBuf, sync::{mpsc, Mutex}, time::Duration};
use tauri::{Emitter, Manager, PhysicalPosition};

#[derive(Default)]
pub struct Overlay { layout: Mutex<Layout>, disk: Mutex<()> }
#[derive(Default)]
struct Layout {
    settings: Preferences,
    path: Option<PathBuf>,
    writer: Option<mpsc::Sender<()>>,
    previous: Option<(isize, u32)>,
    initialized: bool,
    save_error: Option<String>,
    frontend_ready: bool,
    open_error: Option<String>,
    backdrop_error: Option<String>,
    editing: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub pinned: bool, pub visible: bool, pub width: f64, pub height: f64,
    pub save_error: Option<String>,
    pub ready: bool, pub open_error: Option<String>,
    pub editing: bool,
}

pub fn initialize(app: &tauri::AppHandle) -> Result<(), String> {
    let path = app.path().app_config_dir().map_err(|e| e.to_string())?.join("overlay.json");
    let loaded = preferences::load(&path);
    let (mut settings, error) = match loaded { Ok(s) => (s, None), Err(e) => (Preferences::default(), Some(e)) };
    let window = app.get_webview_window("overlay").ok_or("Overlay unavailable")?;
    window.set_size(tauri::LogicalSize::new(settings.width, settings.height)).map_err(|e| e.to_string())?;
    window.set_always_on_top(settings.pinned).map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    settings.position = preferences::reachable(settings.position, (size.width, size.height), &monitor_areas(app)?);
    if let Some((x, y)) = settings.position { window.set_position(PhysicalPosition::new(x, y)).map_err(|e| e.to_string())?; }
    else { window.center().map_err(|e| e.to_string())?; }
    let (sender, receiver) = mpsc::channel();
    {
        let state = app.state::<Overlay>();
        let mut layout = state.layout.lock().map_err(|e| e.to_string())?;
        layout.settings = settings; layout.path = Some(path); layout.writer = Some(sender);
        layout.save_error = error; layout.initialized = true;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        while receiver.recv().is_ok() {
            // Keep drag/resize smooth; persist after 300 ms without new movement.
            while receiver.recv_timeout(Duration::from_millis(300)).is_ok() {}
            if let Err(error) = flush(&app) { eprintln!("{error}"); }
        }
    });
    Ok(())
}

/// Hide our own windows immediately before capture, without DWM fade-out ghosts.
/// This affects only Veylo AI's windows for their lifetime, never global Windows settings.
pub fn prepare_capture_windows(app: &tauri::AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows::Win32::{Foundation::HWND, Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_TRANSITIONS_FORCEDISABLED}};
        let disabled: i32 = 1;
        for label in ["main", "overlay", "backdrop"] {
            let window = app.get_webview_window(label).ok_or("Окно Veylo AI недоступно для захвата.")?;
            let handle = window.hwnd().map_err(|e| e.to_string())?;
            unsafe {
                DwmSetWindowAttribute(HWND(handle.0), DWMWA_TRANSITIONS_FORCEDISABLED, (&disabled as *const i32).cast(), std::mem::size_of_val(&disabled) as u32)
            }.map_err(|_| "Не удалось убрать анимацию окон перед снимком. Повтори захват.".to_owned())?;
        }
        #[cfg(debug_assertions)]
        println!("CAPTURE_HIDE_READY animations_disabled=true");
    }
    #[cfg(not(windows))]
    let _ = app;
    Ok(())
}

pub fn flush(app: &tauri::AppHandle) -> Result<(), String> {
    // Capture the final native geometry too, even if the last move event was skipped.
    if let Some(window) = app.get_webview_window("overlay") {
        if let (Ok(position), Ok(size), Ok(scale)) = (window.outer_position(), window.inner_size(), window.scale_factor()) {
            record_geometry(app, position, size, scale, false);
        }
    }
    let state = app.state::<Overlay>();
    let _disk = state.disk.lock().map_err(|e| e.to_string())?;
    let (settings, path) = {
        let layout = state.layout.lock().map_err(|e| e.to_string())?;
        (layout.settings.clone(), layout.path.clone())
    };
    let Some(path) = path else { return Ok(()); };
    let result = preferences::save(&path, &settings);
    state.layout.lock().map_err(|e| e.to_string())?.save_error = result.as_ref().err().cloned();
    drop(_disk);
    let _ = publish(app);
    result
}

pub fn geometry_changed(window: &tauri::Window) {
    if window.label() != "overlay" { return; }
    let (Ok(position), Ok(size), Ok(scale)) = (window.outer_position(), window.inner_size(), window.scale_factor()) else { return; };
    record_geometry(window.app_handle(), position, size, scale, true);
}
fn record_geometry(app: &tauri::AppHandle, position: PhysicalPosition<i32>, size: tauri::PhysicalSize<u32>, scale: f64, queue: bool) {
    let state = app.state::<Overlay>();
    let Ok(mut layout) = state.layout.try_lock() else { return; };
    if !layout.initialized || size.width == 0 || size.height == 0 { return; }
    let updated = Preferences {
        position: Some((position.x, position.y)), width: size.width as f64 / scale,
        height: size.height as f64 / scale, ..layout.settings.clone()
    }.normalized();
    if updated == layout.settings { return; }
    layout.settings = updated;
    if queue { if let Some(writer) = &layout.writer { let _ = writer.send(()); } }
}

#[tauri::command]
pub fn overlay_view(app: tauri::AppHandle) -> Result<View, String> {
    let visible = app.get_webview_window("overlay").map(|w| w.is_visible()).transpose().map_err(|e| e.to_string())?.unwrap_or(false);
    let state = app.state::<Overlay>();
    let layout = state.layout.lock().map_err(|e| e.to_string())?;
    Ok(View { pinned: layout.settings.pinned, visible, width: layout.settings.width, height: layout.settings.height, save_error: layout.save_error.clone(), ready: layout.frontend_ready, open_error: layout.open_error.clone().or_else(|| if layout.settings.pinned { None } else { layout.backdrop_error.clone() }), editing: layout.editing })
}
fn publish(app: &tauri::AppHandle) -> Result<(), String> {
    app.emit("overlay-mode", overlay_view(app.clone())?).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn frontend_ready(app: tauri::AppHandle, window: tauri::WebviewWindow, role: String) -> Result<(), String> {
    if window.label() != "overlay" { return Ok(()); }
    let state = app.state::<Overlay>();
    {
        let mut layout = state.layout.lock().map_err(|e| e.to_string())?;
        layout.frontend_ready = role == "overlay";
        layout.open_error = if layout.frontend_ready { None } else { Some("Вместо переводчика загрузился интерфейс программы. Перезапусти Veylo AI.".into()) };
    }
    #[cfg(debug_assertions)]
    println!("OVERLAY_FRONTEND_READY ready={}", role == "overlay");
    publish(&app)
}

#[tauri::command]
pub fn backdrop_style_ready(app: tauri::AppHandle, window: tauri::WebviewWindow, transparent_base: bool, hud_styled: bool, gradients: bool) -> Result<(), String> {
    if window.label() != "backdrop" { return Err("Backdrop only".into()); }
    #[cfg(debug_assertions)]
    println!("BACKDROP_STYLE_READY transparent={transparent_base} hud={hud_styled} gradients={gradients}");
    let valid = transparent_base && hud_styled && gradients;
    let pinned = {
        let state = app.state::<Overlay>(); let mut layout = state.layout.lock().map_err(|e| e.to_string())?;
        layout.backdrop_error = if valid { None } else { Some("Стили затемнения не загрузились. Перезапусти обновлённую Veylo AI.".into()) };
        if !valid { layout.editing = false; }
        layout.settings.pinned
    };
    if !valid {
        // Never leave an unstyled full-screen surface covering the game.
        let _ = window.hide();
        if let Some(panel) = app.get_webview_window("overlay") { let _ = panel.set_always_on_top(pinned); }
    }
    publish(&app)
}

#[tauri::command]
pub fn drag_panel(window: tauri::WebviewWindow) -> Result<(), String> { window.start_dragging().map_err(|e| e.to_string()) }

#[tauri::command]
pub fn set_pinned(app: tauri::AppHandle, pinned: bool) -> Result<(), String> {
    if crate::screen_capture::active(&app) { return Err("Нажми Esc, чтобы выйти из перевода экрана.".into()); }
    let window = app.get_webview_window("overlay").ok_or("Overlay unavailable")?;
    let view = overlay_view(app.clone())?;
    window.set_always_on_top(pinned || view.editing).map_err(|e| e.to_string())?;
    app.state::<Overlay>().layout.lock().map_err(|e| e.to_string())?.settings.pinned = pinned;
    let changed = if view.visible && !view.editing && !pinned {
        change(&app, true)
    } else { Ok(()) };
    flush(&app)?;
    changed?;
    publish(&app)
}

#[tauri::command]
pub fn set_panel_size(app: tauri::AppHandle, width: f64, height: f64) -> Result<(), String> {
    if !width.is_finite() || !height.is_finite() || !(320. ..=900.).contains(&width) || !(240. ..=900.).contains(&height) {
        return Err("Размер окна: ширина 320–900, высота 240–900.".into());
    }
    let window = app.get_webview_window("overlay").ok_or("Overlay unavailable")?;
    window.set_size(tauri::LogicalSize::new(width, height)).map_err(|e| e.to_string())?;
    {
        let state = app.state::<Overlay>(); let mut layout = state.layout.lock().map_err(|e| e.to_string())?;
        layout.settings.width = width; layout.settings.height = height;
    }
    keep_reachable(&app)?;
    flush(&app)?;
    publish(&app)
}

fn monitor_areas(app: &tauri::AppHandle) -> Result<Vec<(i32, i32, u32, u32)>, String> {
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    Ok(monitors.iter().map(|m| {
        let a = m.work_area(); (a.position.x, a.position.y, a.size.width, a.size.height)
    }).collect())
}
fn keep_reachable(app: &tauri::AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("overlay").ok_or("Overlay unavailable")?;
    let areas = monitor_areas(app)?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let position = window.outer_position().map_err(|e| e.to_string())?;
    if let Some((x, y)) = preferences::reachable(Some((position.x, position.y)), (size.width, size.height), &areas) {
        window.set_position(PhysicalPosition::new(x, y)).map_err(|e| e.to_string())?;
        app.state::<Overlay>().layout.lock().map_err(|e| e.to_string())?.settings.position = Some((x, y));
    }
    Ok(())
}

#[tauri::command]
pub fn reset_panel_position(app: tauri::AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("overlay").ok_or("Overlay unavailable")?;
    window.center().map_err(|e| e.to_string())?;
    let p = window.outer_position().map_err(|e| e.to_string())?;
    app.state::<Overlay>().layout.lock().map_err(|e| e.to_string())?.settings.position = Some((p.x, p.y));
    flush(&app)
}

#[tauri::command]
pub fn show_main(app: tauri::AppHandle) -> Result<(), String> {
    if crate::screen_capture::active(&app) { return Err("Сначала заверши выделение экрана.".into()); }
    if overlay_view(app.clone())?.editing {
        if let Err(error) = dismiss_overlay(app.clone()) { eprintln!("{error}"); }
    }
    let window = app.get_webview_window("main").ok_or("Main unavailable")?;
    window.show().map_err(|e| e.to_string())?;
    window.unminimize().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}
pub fn resume_widget_after_capture(app: &tauri::AppHandle, was_visible: bool) -> Result<(), String> {
    let panel = app.get_webview_window("overlay").ok_or("Overlay unavailable")?;
    let pinned = overlay_view(app.clone())?.pinned;
    panel.set_always_on_top(pinned).map_err(|e| e.to_string())?;
    if pinned && was_visible { panel.show().map_err(|e| e.to_string())?; }
    else { panel.hide().map_err(|e| e.to_string())?; }
    publish(app)
}
fn show_backdrop(app: &tauri::AppHandle) -> Result<(), String> {
    let panel = app.get_webview_window("overlay").ok_or("Overlay unavailable")?;
    let monitor = panel.current_monitor().map_err(|e| e.to_string())?
        .or(app.primary_monitor().map_err(|e| e.to_string())?).ok_or("Monitor unavailable")?;
    let backdrop = app.get_webview_window("backdrop").ok_or("Backdrop unavailable")?;
    backdrop.set_position(*monitor.position()).map_err(|e| e.to_string())?;
    backdrop.set_size(*monitor.size()).map_err(|e| e.to_string())?;
    backdrop.show().map_err(|e| e.to_string())
}
/// Exiting the dimmed mode keeps a visible pinned widget in the game.
fn keep_widget_on_dismiss(pinned: bool, visible: bool) -> bool { pinned && visible }
// Opening the workspace and pinning a widget after leaving it are separate actions.
fn should_dismiss_on_toggle(editing: bool) -> bool { editing }

#[tauri::command]
pub fn dismiss_overlay(app: tauri::AppHandle) -> Result<(), String> {
    if crate::screen_capture::active(&app) { return crate::screen_capture::cancel(&app); }
    let panel = app.get_webview_window("overlay").ok_or("Overlay unavailable")?;
    let backdrop = app.get_webview_window("backdrop").ok_or("Backdrop unavailable")?;
    let focused = panel.is_focused().map_err(|e| e.to_string())? || backdrop.is_focused().map_err(|e| e.to_string())?;
    backdrop.hide().map_err(|e| e.to_string())?;
    let view = overlay_view(app.clone())?;
    if !keep_widget_on_dismiss(view.pinned, view.visible) { panel.hide().map_err(|e| e.to_string())?; }
    panel.set_always_on_top(view.pinned).map_err(|e| e.to_string())?;
    let previous = {
        let state = app.state::<Overlay>(); let mut layout = state.layout.lock().map_err(|e| e.to_string())?;
        layout.editing = false; layout.previous.take()
    };
    if focused { focus::restore(previous); }
    let saved = flush(&app);
    publish(&app)?;
    saved
}
pub fn change(app: &tauri::AppHandle, visible: bool) -> Result<(), String> {
    if crate::screen_capture::active(app) { return Err("Сначала заверши выделение экрана.".into()); }
    if !visible { return hide_overlay(app.clone()); }
    let window = app.get_webview_window("overlay").ok_or("Overlay unavailable")?;
    let owns_focus = window.is_focused().unwrap_or(false)
        || app.get_webview_window("backdrop").is_some_and(|w| w.is_focused().unwrap_or(false));
    if !owns_focus {
        if let Some(previous) = focus::capture() { app.state::<Overlay>().layout.lock().map_err(|e| e.to_string())?.previous = Some(previous); }
    }
    app.state::<Overlay>().layout.lock().map_err(|e| e.to_string())?.open_error = None;
    let result = (|| -> Result<(), String> {
        if let Some(error) = &app.state::<Overlay>().layout.lock().map_err(|e| e.to_string())?.backdrop_error {
            return Err(error.clone());
        }
        keep_reachable(app)?;
        show_backdrop(app)?;
        // The compact panel must be above the full-monitor dimming window.
        window.set_always_on_top(false).map_err(|e| e.to_string())?;
        window.set_always_on_top(true).map_err(|e| e.to_string())?;
        let opened = (|| -> Result<(), String> {
            window.show().map_err(|e| e.to_string())?;
            window.unminimize().map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
            if !window.is_visible().map_err(|e| e.to_string())? {
                return Err("Windows не показала окно переводчика. Попробуй «Открыть в центре».".into());
            }
            Ok(())
        })();
        opened?;
        app.state::<Overlay>().layout.lock().map_err(|e| e.to_string())?.editing = true;
        Ok(())
    })();
    if let Err(error) = &result {
        if let Some(backdrop) = app.get_webview_window("backdrop") { let _ = backdrop.hide(); }
        let pinned = {
            let state = app.state::<Overlay>(); let mut layout = state.layout.lock().map_err(|e| e.to_string())?;
            layout.editing = false; layout.open_error = Some(error.clone()); layout.settings.pinned
        };
        let _ = window.set_always_on_top(pinned);
    }
    let published = publish(app);
    result.and(published)
}
#[tauri::command]
pub fn set_overlay(app: tauri::AppHandle, overlay: bool) -> Result<View, String> {
    change(&app, overlay)?;
    overlay_view(app)
}
#[tauri::command]
pub fn open_overlay_centered(app: tauri::AppHandle) -> Result<View, String> {
    // A settings write failure must not prevent recovering the visible window.
    let window = app.get_webview_window("overlay").ok_or("Overlay unavailable")?;
    window.center().map_err(|e| e.to_string())?;
    if let Err(error) = flush(&app) { eprintln!("{error}"); }
    change(&app, true)?;
    overlay_view(app)
}
#[tauri::command]
pub fn hide_overlay(app: tauri::AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("overlay").ok_or("Overlay unavailable")?;
    let backdrop = app.get_webview_window("backdrop").ok_or("Backdrop unavailable")?;
    let focused = window.is_focused().map_err(|e| e.to_string())? || backdrop.is_focused().map_err(|e| e.to_string())?;
    backdrop.hide().map_err(|e| e.to_string())?;
    window.hide().map_err(|e| e.to_string())?;
    let (previous, pinned) = {
        let state = app.state::<Overlay>(); let mut layout = state.layout.lock().map_err(|e| e.to_string())?;
        layout.editing = false; (layout.previous.take(), layout.settings.pinned)
    };
    window.set_always_on_top(pinned).map_err(|e| e.to_string())?;
    if focused { focus::restore(previous); }
    let saved = flush(&app);
    publish(&app)?;
    saved
}
pub fn toggle(app: &tauri::AppHandle) -> Result<(), String> {
    let view = overlay_view(app.clone())?;
    if should_dismiss_on_toggle(view.editing) {
        dismiss_overlay(app.clone())
    } else { change(app, true) }
}

#[cfg(test)]
mod mode_tests {
    use super::{keep_widget_on_dismiss, should_dismiss_on_toggle};
    #[test]
    fn shortcut_opens_workspace_even_when_a_pinned_widget_is_visible() {
        // Hidden -> workspace -> Escape -> visible pinned widget -> workspace.
        for pinned in [false, true] {
            assert!(!should_dismiss_on_toggle(false));
            assert!(should_dismiss_on_toggle(true));
            let after_escape = keep_widget_on_dismiss(pinned, true);
            assert_eq!(after_escape, pinned);
            assert!(!should_dismiss_on_toggle(false));
        }
    }
    #[test]
    fn leaving_dimmed_mode_preserves_only_visible_pinned_translator() {
        assert!(keep_widget_on_dismiss(true, true));
        assert!(!keep_widget_on_dismiss(false, true));
        assert!(!keep_widget_on_dismiss(true, false));
        assert!(!keep_widget_on_dismiss(false, false));
    }
}
