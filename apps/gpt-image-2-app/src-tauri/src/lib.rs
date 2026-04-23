use std::path::Path;

use gpt_image_2_core::{
    AppConfig, default_config_path, history_db_path, jobs_dir, list_history_jobs, load_app_config,
    redact_app_config, save_app_config, shared_config_dir, show_history_job,
};
use serde_json::{Value, json};

fn app_error(error: gpt_image_2_core::AppError) -> String {
    format!("{}: {}", error.code, error.message)
}

#[tauri::command]
fn config_path() -> Value {
    json!({
        "config_dir": shared_config_dir().display().to_string(),
        "config_file": default_config_path().display().to_string(),
        "history_file": history_db_path().display().to_string(),
        "jobs_dir": jobs_dir().display().to_string(),
    })
}

#[tauri::command]
fn config_inspect() -> Result<Value, String> {
    let path = default_config_path();
    let config = load_app_config(&path).map_err(app_error)?;
    Ok(json!({
        "config_file": path.display().to_string(),
        "exists": path.is_file(),
        "config": redact_app_config(&config),
    }))
}

#[tauri::command]
fn config_save(config: AppConfig) -> Result<Value, String> {
    let path = default_config_path();
    save_app_config(&path, &config).map_err(app_error)?;
    Ok(json!({
        "ok": true,
        "config_file": path.display().to_string(),
        "config": redact_app_config(&config),
    }))
}

#[tauri::command]
fn history_list() -> Result<Value, String> {
    Ok(json!({
        "history_file": history_db_path().display().to_string(),
        "jobs": list_history_jobs().map_err(app_error)?,
    }))
}

#[tauri::command]
fn history_show(job_id: String) -> Result<Value, String> {
    Ok(json!({
        "history_file": history_db_path().display().to_string(),
        "job": show_history_job(&job_id).map_err(app_error)?,
    }))
}

#[tauri::command]
fn provider_test(name: String) -> Value {
    json!({
        "provider": name,
        "command": "provider_test",
        "note": "Backend contract placeholder; CLI config test-provider is the source of truth.",
    })
}

#[tauri::command]
fn reveal_path(path: String) -> bool {
    Path::new(&path).exists()
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            config_path,
            config_inspect,
            config_save,
            history_list,
            history_show,
            provider_test,
            reveal_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running gpt-image-2-app");
}
