mod overlay;
mod status;
mod translation;
mod session;
mod preferences;
mod window_focus;
mod screen_capture;
mod screen_image;
mod hotkeys;
mod history;

use status::{AppStatus, RuntimeState};
use tauri::{menu::{Menu, MenuItem}, tray::TrayIconBuilder, Emitter, Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;

#[tauri::command]
async fn translate_text(app: tauri::AppHandle, text: String, direction: translation::Direction) -> Result<translation::Translation, String> {
    if screen_capture::active(&app) { return Err("Сначала заверши выделение экрана.".into()); }
    translation::validate(&text)?;
    translation::acquire(&app.state::<translation::Translator>())?;
    let start = app.state::<session::Session>().begin(text.clone(), direction);
    let start = match start {
        Ok(snapshot) => snapshot,
        Err(error) => {
            app.state::<translation::Translator>().0.store(false, std::sync::atomic::Ordering::SeqCst);
            return Err(error);
        }
    };
    let _ = app.emit("translation-state", start);
    let history_app=app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let result=translation::translate(&text,direction);
        if let Ok(translation)=&result {history::record(&history_app,history::Mode::Text,text,translation);}
        result
    })
        .await.map_err(|_| "Ошибка выполнения перевода.".to_owned());
    // Also release on a worker panic.
    let result = result.and_then(|result| result);
    let snapshot = app.state::<session::Session>().finish(direction, &result);
    app.state::<translation::Translator>().0.store(false, std::sync::atomic::Ordering::SeqCst);
    if let Ok(snapshot) = snapshot { let _ = app.emit("translation-state", snapshot); }
    if result.is_ok() { app.state::<RuntimeState>().set_ai_connected(true)?; }
    result
}

#[tauri::command]
fn translation_snapshot(state: State<'_, session::Session>) -> Result<session::Snapshot, String> { state.snapshot() }

// #[tauri::command] exposes a Rust function to our local TypeScript interface.
// The interface calls its name with invoke(); Tauri serializes the result.
#[tauri::command]
fn get_app_status(state: State<'_, RuntimeState>) -> Result<AppStatus, String> {
    let status = state.snapshot()?;
    #[cfg(debug_assertions)]
    println!("RUST_IPC_READY platform={} shortcut={}", status.platform, status.shortcut_registered);
    Ok(status)
}

#[tauri::command]
fn copy_text(app: tauri::AppHandle, text: String) -> Result<(), String> {
    status::validate_clipboard_text(&text)?;
    app.clipboard().write_text(text).map_err(|e| e.to_string())
}

fn reveal(app: &tauri::AppHandle) -> Result<(), String> {
    overlay::show_main(app.clone())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
        if let Err(error) = reveal(app) { eprintln!("Cannot restore overlay: {error}"); }
    }));
    builder
        .manage(RuntimeState::default())
        .manage(hotkeys::Hotkeys::default())
        .manage(history::History::default())
        .manage(overlay::Overlay::default())
        .manage(translation::Translator::default())
        .manage(session::Session::default())
        .manage(screen_capture::Capture::default())
        .plugin(tauri_plugin_clipboard_manager::init())
        .on_window_event(|window, event| {
            if window.label()=="main" && matches!(event,tauri::WindowEvent::Focused(false) | tauri::WindowEvent::CloseRequested {..}) {hotkeys::stop_recording(window.app_handle());}
            if matches!(event, tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)) { overlay::geometry_changed(window); }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if window.label() == "overlay" {
                    if let Err(error) = overlay::hide_overlay(window.app_handle().clone()) { eprintln!("{error}"); }
                } else if window.label() == "backdrop" {
                    let result = if screen_capture::active(window.app_handle()) { screen_capture::cancel(window.app_handle()) } else { overlay::dismiss_overlay(window.app_handle().clone()) };
                    if let Err(error) = result { eprintln!("{error}"); }
                } else if let Err(error) = window.hide() { eprintln!("{error}"); }
            }
        })
        .setup(|app| {
            overlay::initialize(app.handle())?;
            if let Err(error)=history::initialize(app.handle()){eprintln!("{error}");}
            // Tray is a recovery route if the shortcut is occupied by another app.
            let show = MenuItem::with_id(app, "show", "Открыть приложение", true, None::<&str>)?;
            let overlay_item = MenuItem::with_id(app, "overlay", "Открыть оверлей", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Завершить работу", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&overlay_item, &show, &quit])?;
            let icon = app.default_window_icon().ok_or("Missing application icon")?.clone();
            TrayIconBuilder::new()
                .icon(icon)
                .tooltip("Veylo AI")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => { if let Err(error) = reveal(app) { eprintln!("Cannot show overlay: {error}"); } }
                    "overlay" => { if let Err(error) = overlay::change(app, true) { eprintln!("{error}"); } }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            #[cfg(all(desktop, feature = "overlay"))]
            {
                app.handle().plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(hotkeys::handle).build())?;
                hotkeys::initialize(app.handle())?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![history::history_action, hotkeys::get_hotkeys, hotkeys::set_hotkey, hotkeys::set_hotkey_recording, get_app_status, translation_snapshot, screen_capture::start_screen_capture, screen_capture::start_cursor_line, screen_capture::screen_capture_frame, screen_capture::screen_capture_status, screen_capture::finish_screen_capture, screen_capture::cancel_screen_capture, overlay::backdrop_style_ready, overlay::frontend_ready, overlay::dismiss_overlay, overlay::open_overlay_centered, overlay::show_main, overlay::set_pinned, overlay::drag_panel, overlay::set_panel_size, overlay::reset_panel_position, overlay::hide_overlay, overlay::set_overlay, overlay::overlay_view, copy_text, translate_text])
        .build(tauri::generate_context!())
        .expect("Veylo AI failed to start")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::ExitRequested { .. }) {
                if let Err(error)=history::flush(app){eprintln!("{error}");}
                if let Err(error) = overlay::flush(app) { eprintln!("{error}"); }
            }
        });
}
