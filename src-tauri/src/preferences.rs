use serde::{Deserialize, Serialize};
use std::{fs, io::Write, path::Path};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Preferences {
    pub pinned: bool,
    pub position: Option<(i32, i32)>,
    pub width: f64,
    pub height: f64,
    // Missing in old files: shrink once for the compact widget update.
    #[serde(default)]
    pub size_revision: u8,
}
impl Default for Preferences {
    fn default() -> Self { Self { pinned: false, position: None, width: 360., height: 280., size_revision: 1 } }
}
impl Preferences {
    pub fn normalized(mut self) -> Self {
        if self.size_revision == 0 {
            self.width = 360.; self.height = 280.; self.size_revision = 1;
        }
        self.width = if self.width.is_finite() { self.width.clamp(320., 900.) } else { 360. };
        self.height = if self.height.is_finite() { self.height.clamp(240., 900.) } else { 280. };
        self
    }
}

pub fn load(path: &Path) -> Result<Preferences, String> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice::<Preferences>(&bytes).map(Preferences::normalized)
            .map_err(|_| "Настройки окна повреждены. Используются стандартные.".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Preferences::default()),
        Err(_) => Err("Не удалось прочитать настройки окна.".into()),
    }
}
pub fn save(path: &Path, settings: &Preferences) -> Result<(), String> {
    let result = (|| -> Result<(), Box<dyn std::error::Error>> {
        let directory = path.parent().ok_or("Missing settings directory")?;
        fs::create_dir_all(directory)?;
        // Replace atomically: an interrupted write leaves the previous settings intact.
        let mut file = tempfile::NamedTempFile::new_in(directory)?;
        serde_json::to_writer_pretty(&mut file, settings)?;
        file.flush()?;
        file.as_file().sync_all()?;
        file.persist(path)?;
        Ok(())
    })();
    result.map_err(|error| {
        eprintln!("Overlay preferences write failed: {error}");
        "Не удалось сохранить настройки окна. Проверь доступ к папке настроек Veylo AI.".into()
    })
}

/// Physical coordinates allow monitors to the left/above the primary screen.
pub fn reachable(position: Option<(i32, i32)>, size: (u32, u32), areas: &[(i32, i32, u32, u32)]) -> Option<(i32, i32)> {
    let requested = position?;
    let (x, y) = (requested.0 as i64, requested.1 as i64);
    let area = areas.iter().min_by_key(|&&(ax, ay, aw, ah)| {
        let dx = (ax as i64 - x).max(0).max(x - (ax as i64 + aw as i64));
        let dy = (ay as i64 - y).max(0).max(y - (ay as i64 + ah as i64));
        // Avoid overflow for hostile/corrupt saved coordinates.
        dx as i128 * dx as i128 + dy as i128 * dy as i128
    })?;
    let (ax, ay, aw, ah) = *area;
    Some((x.clamp(ax as i64, ax as i64 + aw.saturating_sub(size.0) as i64) as i32,
          y.clamp(ay as i64, ay as i64 + ah.saturating_sub(size.1) as i64) as i32))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pin_position_and_size_survive_a_fresh_load_and_overwrite() {
        let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("overlay.json");
        assert_eq!(load(&path).unwrap(), Preferences::default());
        let mut expected = Preferences { pinned: true, position: Some((-1200, 140)), width: 510., height: 390., ..Preferences::default() };
        save(&path, &expected).unwrap();
        assert_eq!(load(&path).unwrap(), expected);
        expected.pinned = false; expected.position = Some((400, 250));
        save(&path, &expected).unwrap();
        assert_eq!(load(&path).unwrap(), expected);
    }
    #[test]
    fn damaged_and_out_of_range_settings_recover() {
        let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("overlay.json");
        fs::write(&path, b"{").unwrap(); assert!(load(&path).is_err());
        fs::write(&path, br#"{"pinned":true,"width":100000,"height":0,"sizeRevision":1}"#).unwrap();
        let settings = load(&path).unwrap();
        assert!(settings.pinned); assert_eq!((settings.width, settings.height), (900., 240.));
        assert_eq!(Preferences { width: f64::NAN, ..Preferences::default() }.normalized().width, 360.);
        assert!(save(dir.path(), &settings).is_err());
    }
    #[test]
    fn old_window_shrinks_once_without_losing_mode_or_position() {
        let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("overlay.json");
        fs::write(&path, br#"{"pinned":true,"position":[100,200],"width":560,"height":650}"#).unwrap();
        let mut migrated = load(&path).unwrap();
        assert_eq!((migrated.width, migrated.height), (360., 280.));
        assert!(migrated.pinned); assert_eq!(migrated.position, Some((100, 200)));
        migrated.width = 480.; migrated.height = 350.;
        save(&path, &migrated).unwrap();
        assert_eq!(load(&path).unwrap(), migrated);
    }
    #[test]
    fn a_removed_monitor_or_smaller_screen_cannot_strand_the_window() {
        let areas = [(-1920, 0, 1920, 1080), (0, 0, 1280, 720)];
        assert_eq!(reachable(Some((-1500, 100)), (420, 360), &areas), Some((-1500, 100)));
        assert_eq!(reachable(Some((3000, 2000)), (420, 360), &areas), Some((860, 360)));
        assert_eq!(reachable(Some((400, 500)), (420, 360), &[(0, 0, 300, 200)]), Some((0, 0)));
        assert_eq!(reachable(None, (420, 360), &areas), None);
        assert_eq!(reachable(Some((i32::MAX, i32::MIN)), (420, 360), &[]), None);
    }
}
