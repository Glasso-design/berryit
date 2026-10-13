//! BERRYiT Control Center – Windows-desktop.
//!
//! Rust-sidan gör avsiktligt lite: den håller fönstret, lagrar sessionen i
//! Windows Credential Manager och sparar vilken backend klienten pekar mot.
//! Ingen affärslogik och inga behörighetsbeslut finns här – de ligger i
//! databasens RLS-policyer, precis som för webbklienten.

mod app_config;
mod secure_store;

use app_config::AppConfig;
use tauri::AppHandle;

#[derive(serde::Serialize)]
struct AppInfo {
    version: String,
    platform: String,
    /// Sant när sessionen lagras i Windows Credential Manager.
    secure_storage: bool,
}

#[tauri::command]
fn app_info(app: AppHandle) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        platform: std::env::consts::OS.to_string(),
        secure_storage: cfg!(windows),
    }
}

#[tauri::command]
fn secret_get(key: String) -> Result<Option<String>, secure_store::StoreError> {
    secure_store::get(&key)
}

#[tauri::command]
fn secret_set(key: String, value: String) -> Result<(), secure_store::StoreError> {
    secure_store::set(&key, &value)
}

#[tauri::command]
fn secret_remove(key: String) -> Result<(), secure_store::StoreError> {
    secure_store::remove(&key)
}

#[tauri::command]
fn config_load(app: AppHandle) -> Result<AppConfig, app_config::ConfigError> {
    app_config::load(&app)
}

#[tauri::command]
fn config_save(app: AppHandle, config: AppConfig) -> Result<AppConfig, app_config::ConfigError> {
    app_config::save(&app, config)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // HTTP-anropen till backenden går genom Rust, inte genom WebView2.
        // Det är så en desktopklient ska göra: anropen omfattas inte av
        // webbläsarens origin-regler, och gatewayen behöver därför inga
        // CORS-undantag för appen.
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            app_info,
            secret_get,
            secret_set,
            secret_remove,
            config_load,
            config_save
        ])
        .setup(|app| {
            // Öppna devtools bara i utvecklingsbygget.
            #[cfg(debug_assertions)]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }
            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("kunde inte starta BERRYiT Control Center");
}
