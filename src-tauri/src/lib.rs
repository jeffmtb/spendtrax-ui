mod appearance;
mod database;

use database::{checked_database_path, save_transactions};
use directories::ProjectDirs;
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

// Transaction struct matching the SQLite schema
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Transaction {
    pub id: i64,
    pub transaction_date: String,
    pub year: i32,
    pub description: String,
    pub category: Option<String>,
    pub amount: f64,
    pub retirement: bool,
    pub account: String,
    pub check_number: Option<String>,
}

// For updating transactions
#[derive(Debug, Serialize, Deserialize)]
pub struct TransactionUpdate {
    pub id: i64,
    pub transaction_date: String,
    pub description: String,
    pub category: Option<String>,
    pub amount: f64,
    pub retirement: bool,
    pub account: String,
    pub check_number: Option<String>,
}

// App state to hold database path
pub struct AppState {
    pub db_path: Mutex<Option<String>>,
}

// Get the config directory path for storing preferences
fn get_config_path() -> Option<PathBuf> {
    if let Some(proj_dirs) = ProjectDirs::from("com", "jeffl", "spendtrax-ui") {
        let config_dir = proj_dirs.config_dir();
        fs::create_dir_all(config_dir).ok()?;
        Some(config_dir.join("db_path.txt"))
    } else {
        None
    }
}

// Load saved database path from config
fn load_saved_db_path() -> Option<String> {
    let config_path = get_config_path()?;
    fs::read_to_string(config_path).ok()
}

// Save database path to config
fn save_db_path(path: &str) -> Result<(), String> {
    let config_path = get_config_path().ok_or("Could not get config directory")?;
    fs::write(config_path, path).map_err(|e| e.to_string())
}

// Get default database path (same directory as executable)
fn get_default_db_path() -> Option<PathBuf> {
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            return Some(exe_dir.join("spendtrax.db"));
        }
    }
    None
}

#[tauri::command]
fn get_database_status(state: State<AppState>) -> Result<Option<String>, String> {
    let db_path = state.db_path.lock().map_err(|e| e.to_string())?;
    Ok(db_path.clone())
}

#[tauri::command]
fn initialize_database(state: State<AppState>) -> Result<Option<String>, String> {
    // First check if we have a saved path
    if let Some(saved_path) = load_saved_db_path() {
        if PathBuf::from(&saved_path).exists() {
            let mut db_path = state.db_path.lock().map_err(|e| e.to_string())?;
            *db_path = Some(saved_path.clone());
            return Ok(Some(saved_path));
        }
    }

    // Then check default location
    if let Some(default_path) = get_default_db_path() {
        if default_path.exists() {
            let path_str = default_path.to_string_lossy().to_string();
            let mut db_path = state.db_path.lock().map_err(|e| e.to_string())?;
            *db_path = Some(path_str.clone());
            return Ok(Some(path_str));
        }
    }

    // No database found
    Ok(None)
}

#[tauri::command]
fn set_database_path(path: String, state: State<AppState>) -> Result<(), String> {
    // Validate before replacing the active database or its saved preference.
    let conn = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Cannot open database: {e}"))?;
    conn.prepare(
        "SELECT id, transaction_date, year, description, category, amount,
                retirement, account, check_number FROM transactions LIMIT 0",
    )
    .map_err(|e| format!("Incompatible SpendTrax database: {e}"))?;

    let mut db_path = state.db_path.lock().map_err(|e| e.to_string())?;
    save_db_path(&path)?;
    *db_path = Some(path);

    Ok(())
}

#[tauri::command]
fn get_all_transactions(state: State<AppState>) -> Result<Vec<Transaction>, String> {
    let db_path = state.db_path.lock().map_err(|e| e.to_string())?;
    let path = db_path.as_ref().ok_or("Database not initialized")?;

    let conn = Connection::open(path).map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare(
        "SELECT id, transaction_date, year, description, category, amount, retirement, account, check_number 
         FROM transactions 
         ORDER BY transaction_date DESC"
    ).map_err(|e| e.to_string())?;

    let transactions = stmt
        .query_map([], |row| {
            Ok(Transaction {
                id: row.get(0)?,
                transaction_date: row.get(1)?,
                year: row.get(2)?,
                description: row.get(3)?,
                category: row.get(4)?,
                amount: row.get(5)?,
                retirement: row.get(6)?,
                account: row.get(7)?,
                check_number: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for transaction in transactions {
        result.push(transaction.map_err(|e| e.to_string())?);
    }

    Ok(result)
}

#[tauri::command]
fn update_transaction(
    transaction: TransactionUpdate,
    expected_database_path: String,
    state: State<AppState>,
) -> Result<(), String> {
    update_transactions_batch(vec![transaction], expected_database_path, state)
}

#[tauri::command]
fn update_transactions_batch(
    transactions: Vec<TransactionUpdate>,
    expected_database_path: String,
    state: State<AppState>,
) -> Result<(), String> {
    // Hold the lock through the commit so a database switch cannot race a save.
    let db_path = state.db_path.lock().map_err(|e| e.to_string())?;
    let path = checked_database_path(db_path.as_deref(), &expected_database_path)?;
    let mut conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE)
        .map_err(|e| e.to_string())?;
    save_transactions(&mut conn, &transactions)
}

#[tauri::command]
fn get_unique_years(state: State<AppState>) -> Result<Vec<i32>, String> {
    let db_path = state.db_path.lock().map_err(|e| e.to_string())?;
    let path = db_path.as_ref().ok_or("Database not initialized")?;

    let conn = Connection::open(path).map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT DISTINCT year FROM transactions ORDER BY year DESC")
        .map_err(|e| e.to_string())?;

    let years = stmt
        .query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for year in years {
        result.push(year.map_err(|e| e.to_string())?);
    }

    Ok(result)
}

#[tauri::command]
fn get_unique_categories(state: State<AppState>) -> Result<Vec<String>, String> {
    let db_path = state.db_path.lock().map_err(|e| e.to_string())?;
    let path = db_path.as_ref().ok_or("Database not initialized")?;

    let conn = Connection::open(path).map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare(
        "SELECT DISTINCT category FROM transactions WHERE category IS NOT NULL ORDER BY category"
    ).map_err(|e| e.to_string())?;

    let categories = stmt
        .query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for category in categories {
        result.push(category.map_err(|e| e.to_string())?);
    }

    Ok(result)
}

#[tauri::command]
fn get_unique_accounts(state: State<AppState>) -> Result<Vec<String>, String> {
    let db_path = state.db_path.lock().map_err(|e| e.to_string())?;
    let path = db_path.as_ref().ok_or("Database not initialized")?;

    let conn = Connection::open(path).map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT DISTINCT account FROM transactions ORDER BY account")
        .map_err(|e| e.to_string())?;

    let accounts = stmt
        .query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for account in accounts {
        result.push(account.map_err(|e| e.to_string())?);
    }

    Ok(result)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            db_path: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            appearance::get_system_palette,
            initialize_database,
            get_database_status,
            set_database_path,
            get_all_transactions,
            update_transaction,
            update_transactions_batch,
            get_unique_years,
            get_unique_categories,
            get_unique_accounts,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
