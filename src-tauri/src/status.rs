use serde::Serialize;
use std::sync::Mutex;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub version: &'static str,
    pub platform: &'static str,
    pub shortcut_registered: bool,
    pub shortcut_pending: bool,
    pub shortcut: String,
    pub shortcut_error: Option<String>,
    pub ai_connected: bool,
    pub capture_available: bool,
    pub capture_shortcut_registered: bool,
    pub capture_shortcut: String,
    pub cursor_shortcut_registered: bool,
    pub cursor_shortcut: String,
    pub embedded_browser_available: bool,
}

pub struct RuntimeState(Mutex<AppStatus>);

impl Default for RuntimeState {
    fn default() -> Self {
        Self(Mutex::new(AppStatus {
            version: env!("CARGO_PKG_VERSION"),
            platform: std::env::consts::OS,
            shortcut_registered: false,
            shortcut_pending: cfg!(feature = "overlay"),
            shortcut: "Ctrl + Shift + Space".to_owned(),
            shortcut_error: None,
            ai_connected: false,
            capture_available: cfg!(windows),
            capture_shortcut_registered: false,
            capture_shortcut: "Alt + Q".into(),
            cursor_shortcut_registered: false,
            cursor_shortcut: "Alt + W".into(),
            embedded_browser_available: false,
        }))
    }
}

impl RuntimeState {
    pub fn set_cursor_shortcut(&self, registered:bool, name:&str) -> Result<(),String> {
        let mut status=self.0.lock().map_err(|e|e.to_string())?;
        status.cursor_shortcut_registered=registered; status.cursor_shortcut=name.into(); Ok(())
    }
    pub fn set_capture_shortcut(&self, registered: bool, name: &str) -> Result<(), String> {
        let mut status = self.0.lock().map_err(|_| "Runtime state unavailable")?;
        status.capture_shortcut_registered = registered; status.capture_shortcut = name.into(); Ok(())
    }
    pub fn set_ai_connected(&self, connected: bool) -> Result<(), String> {
        self.0.lock().map_err(|_| "Runtime state is unavailable".to_owned())?.ai_connected = connected;
        Ok(())
    }
    pub fn snapshot(&self) -> Result<AppStatus, String> {
        self.0.lock().map(|status| status.clone()).map_err(|_| "Runtime state is unavailable".to_owned())
    }

    pub fn set_shortcut_result(&self, result: Result<(), String>, shortcut: &str) -> Result<(), String> {
        let mut status = self.0.lock().map_err(|_| "Runtime state is unavailable".to_owned())?;
        status.shortcut_registered = result.is_ok();
        status.shortcut_pending = false;
        status.shortcut_error = result.err();
        status.shortcut = shortcut.to_owned();
        Ok(())
    }
}

pub fn validate_clipboard_text(text: &str) -> Result<(), String> {
    if text.trim().is_empty() { return Err("Нечего копировать".to_owned()); }
    if text.chars().count() > 24_000 { return Err("Текст слишком длинный".to_owned()); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initial_status_does_not_claim_services_are_connected() {
        let status = RuntimeState::default().snapshot().unwrap();
        assert!(!status.ai_connected && !status.embedded_browser_available);
        assert_eq!(status.capture_available, cfg!(windows));
        assert!(!status.shortcut_registered);
        assert_eq!(status.shortcut_pending, cfg!(feature = "overlay"));
    }

    #[test]
    fn shortcut_failure_and_recovery_are_visible() {
        let state = RuntimeState::default();
        state.set_shortcut_result(Err("Already in use".into()), "Ctrl + Shift + Space").unwrap();
        assert_eq!(state.snapshot().unwrap().shortcut_error.as_deref(), Some("Already in use"));
        assert!(!state.snapshot().unwrap().shortcut_pending);
        state.set_shortcut_result(Ok(()), "Ctrl + Alt + Space").unwrap();
        assert!(state.snapshot().unwrap().shortcut_registered);
        assert!(!state.snapshot().unwrap().shortcut_pending);
        assert!(state.snapshot().unwrap().shortcut_error.is_none());
        assert_eq!(state.snapshot().unwrap().shortcut, "Ctrl + Alt + Space");
    }

    #[test]
    fn clipboard_accepts_slovak_and_rejects_empty_and_excessive_text() {
        assert!(validate_clipboard_text("Ďakujem, kde je železo?").is_ok());
        assert!(validate_clipboard_text(" \n ").is_err());
        assert!(validate_clipboard_text(&"č".repeat(24_000)).is_ok());
        assert!(validate_clipboard_text(&"č".repeat(24_001)).is_err());
    }
}
