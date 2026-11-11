use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Deserialize, Serialize, PartialEq)]
pub struct SystemPalette {
    mode: Option<String>,
    background: String,
    foreground: String,
    accent: String,
    lighter_background: Option<String>,
    selection: Option<String>,
    red: Option<String>,
    green: Option<String>,
    yellow: Option<String>,
    cyan: Option<String>,
}

fn valid_color(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
}

fn parse_palette(contents: &str) -> Option<SystemPalette> {
    let mut palette: SystemPalette = toml::from_str(contents).ok()?;
    if ![&palette.background, &palette.foreground, &palette.accent]
        .iter()
        .all(|color| valid_color(color))
    {
        return None;
    }
    if !matches!(palette.mode.as_deref(), Some("dark" | "light")) {
        palette.mode = None;
    }
    for color in [
        &mut palette.lighter_background,
        &mut palette.selection,
        &mut palette.red,
        &mut palette.green,
        &mut palette.yellow,
        &mut palette.cyan,
    ] {
        if color.as_deref().is_some_and(|value| !valid_color(value)) {
            *color = None;
        }
    }
    Some(palette)
}

fn read_palette(path: &Path) -> Option<SystemPalette> {
    use std::io::Read;
    // Read only a small palette file, never arbitrary files supplied by the UI.
    let file = std::fs::File::open(path).ok()?;
    let mut contents = String::new();
    file.take(65_537).read_to_string(&mut contents).ok()?;
    if contents.len() > 65_536 {
        return None;
    }
    parse_palette(&contents)
}

#[tauri::command]
pub fn get_system_palette() -> Option<SystemPalette> {
    #[cfg(target_os = "linux")]
    {
        let dirs = directories::BaseDirs::new()?;
        // Current Omarchy stores generated themes in state; older releases used config.
        let current = dirs
            .home_dir()
            .join(".local/state/omarchy/current/theme/colors.toml");
        let legacy = dirs.config_dir().join("omarchy/current/theme/colors.toml");
        read_palette(&current).or_else(|| read_palette(&legacy))
    }
    #[cfg(not(target_os = "linux"))]
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const COLORS: &str = "background = '#142620'\nforeground = '#dfede5'\naccent = '#8bcbb1'\n";

    #[test]
    fn parses_palette_and_optional_mode() {
        let palette =
            parse_palette(&format!("{COLORS}mode = 'dark'\ngreen = '#8bcbb1'\n")).unwrap();
        assert_eq!(palette.mode.as_deref(), Some("dark"));
        assert_eq!(palette.background, "#142620");
        assert_eq!(palette.green.as_deref(), Some("#8bcbb1"));
        assert!(parse_palette(COLORS).unwrap().mode.is_none());
    }

    #[test]
    fn rejects_missing_or_invalid_required_colors() {
        assert!(parse_palette("background = '#142620'").is_none());
        assert!(parse_palette(&COLORS.replace("#142620", "url(file:///private)")).is_none());
        assert!(parse_palette(&COLORS.replace("#142620", "#nope00")).is_none());
        assert!(parse_palette("not valid TOML").is_none());
    }

    #[test]
    fn ignores_invalid_optional_values() {
        let palette = parse_palette(&format!("{COLORS}mode = 'invalid'\nred = 'red'\n")).unwrap();
        assert!(palette.mode.is_none());
        assert!(palette.red.is_none());
    }

    #[test]
    fn missing_file_returns_no_palette() {
        assert!(read_palette(Path::new("/nonexistent-spendtrax-test/colors.toml")).is_none());
    }
}
