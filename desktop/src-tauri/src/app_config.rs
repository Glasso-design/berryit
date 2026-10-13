//! Appens konfiguration: vilken backend klienten ansluter till.
//!
//! Sparas som JSON i användarens konfigurationsmapp
//! (`%APPDATA%\se.berryit.controlcenter\config.json`). Här ligger inga
//! hemligheter – anon-nyckeln är publik och ger ingen åtkomst i sig, allt
//! avgörs av RLS i databasen. En service-role-nyckel avvisas av klienten
//! innan den ens kan sparas (se src/config.ts).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default)]
    pub backend_url: String,
    #[serde(default)]
    pub anon_key: String,
}

#[derive(Debug, thiserror::Error, Serialize)]
pub enum ConfigError {
    #[error("hittade ingen konfigurationsmapp: {0}")]
    NoDir(String),
    #[error("kunde inte läsa eller skriva konfigurationen: {0}")]
    Io(String),
    #[error("konfigurationen är skadad: {0}")]
    Parse(String),
}

fn path(app: &AppHandle) -> Result<PathBuf, ConfigError> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| ConfigError::NoDir(e.to_string()))?;
    std::fs::create_dir_all(&dir).map_err(|e| ConfigError::Io(e.to_string()))?;
    Ok(dir.join("config.json"))
}

pub fn load(app: &AppHandle) -> Result<AppConfig, ConfigError> {
    let file = path(app)?;
    if !file.exists() {
        return Ok(AppConfig::default());
    }
    let raw = std::fs::read_to_string(&file).map_err(|e| ConfigError::Io(e.to_string()))?;
    serde_json::from_str(&raw).map_err(|e| ConfigError::Parse(e.to_string()))
}

pub fn save(app: &AppHandle, config: AppConfig) -> Result<AppConfig, ConfigError> {
    let file = path(app)?;
    let raw =
        serde_json::to_string_pretty(&config).map_err(|e| ConfigError::Parse(e.to_string()))?;
    std::fs::write(&file, raw).map_err(|e| ConfigError::Io(e.to_string()))?;
    Ok(config)
}
