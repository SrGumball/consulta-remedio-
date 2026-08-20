#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use postgres::{Client, NoTls};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;
use tauri::Emitter;
use fallible_iterator::FallibleIterator;

static LISTENER_ACTIVE: AtomicBool = AtomicBool::new(false);

#[tauri::command]
fn test_postgres_connection(ip: String, db_name: String, password: String) -> Result<String, String> {
    let conn_str = format!("host={} user=postgres password={} dbname={} connect_timeout=3", ip, password, db_name);
    
    match Client::connect(&conn_str, NoTls) {
        Ok(_) => Ok("Conexão bem-sucedida ao Servidor Postgres!".to_string()),
        Err(e) => Err(format!("Erro ao conectar: {}", e)),
    }
}

#[tauri::command]
fn query_postgres(ip: String, db_name: String, password: String, query: String) -> Result<String, String> {
    let conn_str = format!("host={} user=postgres password={} dbname={} connect_timeout=3", ip, password, db_name);
    
    let mut client = match Client::connect(&conn_str, NoTls) {
        Ok(client) => client,
        Err(e) => return Err(format!("Erro ao conectar: {}", e)),
    };

    let rows = match client.query(&query, &[]) {
        Ok(rows) => rows,
        Err(e) => return Err(format!("Erro ao executar query: {}", e)),
    };

    let mut result: Vec<Value> = Vec::new();

    for row in rows {
        let mut map = serde_json::Map::new();
        for (i, column) in row.columns().iter().enumerate() {
            let col_name = column.name().to_string();
            let col_type = column.type_().name();
            
            let val = match col_type {
                "int4" | "int8" => {
                    if let Ok(v) = row.try_get::<_, i64>(i) { json!(v) }
                    else if let Ok(v) = row.try_get::<_, i32>(i) { json!(v) }
                    else { json!(null) }
                },
                "float4" | "float8" => {
                    if let Ok(v) = row.try_get::<_, f64>(i) { json!(v) }
                    else if let Ok(v) = row.try_get::<_, f32>(i) { json!(v) }
                    else { json!(null) }
                },
                "bool" => {
                    if let Ok(v) = row.try_get::<_, bool>(i) { json!(v) }
                    else { json!(null) }
                },
                _ => {
                    if let Ok(v) = row.try_get::<_, String>(i) { json!(v) }
                    else { json!(null) }
                }
            };
            map.insert(col_name, val);
        }
        result.push(Value::Object(map));
    }

    Ok(serde_json::to_string(&result).unwrap_or_else(|_| "[]".to_string()))
}

#[tauri::command]
fn start_db_listener(app_handle: tauri::AppHandle, ip: String, db_name: String, password: String) -> Result<(), String> {
    if LISTENER_ACTIVE.load(Ordering::SeqCst) {
        return Ok(());
    }
    
    LISTENER_ACTIVE.store(true, Ordering::SeqCst);
    
    thread::spawn(move || {
        let conn_str = format!("host={} user=postgres password={} dbname={} connect_timeout=3", ip, password, db_name);
        
        loop {
            match Client::connect(&conn_str, NoTls) {
                Ok(mut client) => {
                    if let Err(e) = client.execute("LISTEN app_update", &[]) {
                        eprintln!("Failed to listen: {}", e);
                        thread::sleep(Duration::from_secs(5));
                        continue;
                    }
                    
                    let mut iter = client.notifications();
                    while let Ok(Some(_)) = iter.next() {
                        let _ = app_handle.emit("db_update", ());
                    }
                },
                Err(e) => {
                    eprintln!("Connection failed: {}", e);
                }
            }
            thread::sleep(Duration::from_secs(3));
        }
    });
    
    Ok(())
}


fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            test_postgres_connection,
            query_postgres,
            start_db_listener
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
