//! In-memory translation state shared by the two local webviews.
use crate::translation::{Direction, Translation};
use serde::Serialize;
use std::sync::Mutex;

#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub revision: u64,
    pub busy: bool,
    pub entries: [Option<Entry>; 9],
}
#[derive(Clone, Serialize)]
pub struct Entry { pub source: String, pub translation: Option<Translation>, pub error: Option<String> }
#[derive(Default)]
pub struct Session(pub Mutex<Snapshot>);
fn index(direction: Direction) -> usize {
    match direction {
        Direction::SlovakToRussian => 0, Direction::RussianToSlovak => 1,
        Direction::EnglishToRussian => 2, Direction::RussianToEnglish => 3,
        Direction::EnglishToSlovak => 4, Direction::SlovakToEnglish => 5,
        Direction::AutoToRussian => 6, Direction::AutoToSlovak => 7, Direction::AutoToEnglish => 8,
    }
}
impl Session {
    pub fn snapshot(&self) -> Result<Snapshot, String> {
        self.0.lock().map(|s| s.clone()).map_err(|_| "Состояние перевода недоступно.".into())
    }
    pub fn begin(&self, source: String, direction: Direction) -> Result<Snapshot, String> {
        let mut s = self.0.lock().map_err(|_| "Состояние перевода недоступно.")?;
        s.busy = true;
        s.revision += 1;
        s.entries[index(direction)] = Some(Entry { source, translation: None, error: None });
        Ok(s.clone())
    }
    pub fn finish(&self, direction: Direction, result: &Result<Translation, String>) -> Result<Snapshot, String> {
        let mut s = self.0.lock().map_err(|_| "Состояние перевода недоступно.")?;
        if let Some(entry) = &mut s.entries[index(direction)] {
            entry.translation = result.as_ref().ok().cloned();
            entry.error = result.as_ref().err().cloned();
        }
        s.busy = false;
        s.revision += 1;
        Ok(s.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn all_language_pairs_have_independent_entries_and_valid_language_names() {
        let session = Session::default();
        for (code, direction, languages) in [
            ("sk-ru", Direction::SlovakToRussian, ("Slovak", "Russian")),
            ("ru-sk", Direction::RussianToSlovak, ("Russian", "Slovak")),
            ("en-ru", Direction::EnglishToRussian, ("English", "Russian")),
            ("ru-en", Direction::RussianToEnglish, ("Russian", "English")),
            ("en-sk", Direction::EnglishToSlovak, ("English", "Slovak")),
            ("sk-en", Direction::SlovakToEnglish, ("Slovak", "English")),
            ("auto-ru", Direction::AutoToRussian, ("auto", "Russian")),
            ("auto-sk", Direction::AutoToSlovak, ("auto", "Slovak")),
            ("auto-en", Direction::AutoToEnglish, ("auto", "English")),
        ] {
            let parsed: Direction = serde_json::from_str(&format!("\"{code}\"")).unwrap();
            assert_eq!(parsed.languages(), languages);
            assert_eq!(serde_json::to_string(&direction).unwrap(), format!("\"{code}\""));
            session.begin(code.into(), direction).unwrap();
            session.finish(direction, &Ok(Translation { text: code.into(), direction, elapsed_ms: 0 })).unwrap();
        }
        let snapshot = session.snapshot().unwrap();
        let sources: Vec<_> = snapshot.entries.iter().map(|entry| {
            let entry = entry.as_ref().unwrap();
            assert_eq!(entry.source, entry.translation.as_ref().unwrap().text);
            entry.source.as_str()
        }).collect();
        assert_eq!(sources, ["sk-ru", "ru-sk", "en-ru", "ru-en", "en-sk", "sk-en", "auto-ru", "auto-sk", "auto-en"]);
        assert!(serde_json::from_str::<Direction>("\"en-en\"").is_err());
    }
    #[test]
    fn shared_state_retains_both_directions_and_releases_pending_on_errors() {
        let session = Session::default();
        assert!(!session.snapshot().unwrap().busy);
        let first = session.begin("Ahoj".into(), Direction::SlovakToRussian).unwrap();
        assert!(first.busy);
        let translated = Translation { text: "Привет".into(), direction: Direction::SlovakToRussian, elapsed_ms: 100 };
        let done = session.finish(Direction::SlovakToRussian, &Ok(translated)).unwrap();
        assert!(!done.busy);
        assert!(done.revision > first.revision);
        session.begin("Тест".into(), Direction::RussianToSlovak).unwrap();
        let failed = session.finish(Direction::RussianToSlovak, &Err("Нет сети".into())).unwrap();
        assert!(!failed.busy);
        assert_eq!(failed.entries[0].as_ref().unwrap().translation.as_ref().unwrap().text, "Привет");
        assert_eq!(failed.entries[1].as_ref().unwrap().error.as_deref(), Some("Нет сети"));
        assert_eq!(session.snapshot().unwrap().revision, failed.revision);
    }
}
