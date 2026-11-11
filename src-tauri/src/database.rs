use crate::TransactionUpdate;
use rusqlite::{params, Connection};

pub fn checked_database_path<'a>(
    current: Option<&'a str>,
    expected: &str,
) -> Result<&'a str, String> {
    let path = current.ok_or("Database not initialized")?;
    if path != expected {
        return Err("The active database changed. Reload before saving edits.".to_string());
    }
    Ok(path)
}

// Accept exactly YYYY-MM-DD with a real Gregorian calendar date (years 1–9999).
fn transaction_year(date: &str) -> Result<i32, String> {
    let invalid = || "Enter a valid date in YYYY-MM-DD format.".to_string();
    let bytes = date.as_bytes();
    if bytes.len() != 10
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || !bytes
            .iter()
            .enumerate()
            .all(|(i, b)| i == 4 || i == 7 || b.is_ascii_digit())
    {
        return Err(invalid());
    }
    let year: i32 = date[..4].parse().map_err(|_| invalid())?;
    let month: u32 = date[5..7].parse().map_err(|_| invalid())?;
    let day: u32 = date[8..].parse().map_err(|_| invalid())?;
    let leap_year = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = match month {
        4 | 6 | 9 | 11 => 30,
        2 if leap_year => 29,
        2 => 28,
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        _ => return Err(invalid()),
    };
    if year == 0 || day == 0 || day > days {
        return Err(invalid());
    }
    Ok(year)
}

pub fn save_transactions(
    conn: &mut Connection,
    transactions: &[TransactionUpdate],
) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for transaction in transactions {
        let year = transaction_year(&transaction.transaction_date)?;
        if !transaction.amount.is_finite() {
            return Err("Amount must be a finite number.".to_string());
        }
        let changed = tx
            .execute(
                "UPDATE transactions SET
                transaction_date = ?1, year = ?2, description = ?3, category = ?4,
                amount = ?5, retirement = ?6, account = ?7, check_number = ?8
             WHERE id = ?9",
                params![
                    transaction.transaction_date,
                    year,
                    transaction.description,
                    transaction.category,
                    transaction.amount,
                    transaction.retirement,
                    transaction.account,
                    transaction.check_number,
                    transaction.id,
                ],
            )
            .map_err(|e| e.to_string())?;
        if changed != 1 {
            return Err("A transaction no longer exists. Reload before saving edits.".to_string());
        }
    }
    tx.commit().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("../../examples/schema.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../../examples/demo.sql"))
            .unwrap();
        conn
    }

    fn update(id: i64, date: &str) -> TransactionUpdate {
        TransactionUpdate {
            id,
            transaction_date: date.to_string(),
            description: "Synthetic edited row".to_string(),
            category: None,
            amount: 42.0,
            retirement: false,
            account: "Demo checking".to_string(),
            check_number: None,
        }
    }

    #[test]
    fn accepts_calendar_dates_including_leap_years() {
        for date in [
            "2026-01-31",
            "2024-02-29",
            "2000-02-29",
            "0001-01-01",
            "9999-12-31",
        ] {
            assert!(transaction_year(date).is_ok(), "{date}");
        }
    }

    #[test]
    fn rejects_invalid_dates_and_formats() {
        for date in [
            "",
            "2026",
            "2026-1-01",
            "2026-01-1",
            "2026-02-29",
            "1900-02-29",
            "2100-02-29",
            "2026-04-31",
            "2026-00-01",
            "2026-13-01",
            "2026-01-00",
            "2026-01-32",
            "0000-01-01",
            "2026-01-01-extra",
            " 2026-01-01",
            "é026-01-01",
        ] {
            assert!(transaction_year(date).is_err(), "{date}");
        }
    }

    #[test]
    fn rejects_saves_after_database_switch() {
        assert!(checked_database_path(Some("B.db"), "A.db").is_err());
        assert!(checked_database_path(None, "A.db").is_err());
        assert_eq!(checked_database_path(Some("A.db"), "A.db").unwrap(), "A.db");
    }

    #[test]
    fn saves_date_and_derived_year_together() {
        let mut conn = database();
        save_transactions(&mut conn, &[update(1, "2024-02-29")]).unwrap();
        let saved: (String, i32, f64) = conn
            .query_row(
                "SELECT transaction_date, year, amount FROM transactions WHERE id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(saved, ("2024-02-29".to_string(), 2024, 42.0));
    }

    #[test]
    fn invalid_date_rolls_back_the_entire_batch() {
        let mut conn = database();
        assert!(save_transactions(
            &mut conn,
            &[update(1, "2024-02-29"), update(2, "2026-02-30")]
        )
        .is_err());
        let amount: f64 = conn
            .query_row("SELECT amount FROM transactions WHERE id = 1", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(amount, 2500.0);
    }

    #[test]
    fn missing_row_rolls_back_the_entire_batch() {
        let mut conn = database();
        assert!(save_transactions(
            &mut conn,
            &[update(1, "2024-02-29"), update(999, "2024-02-29")]
        )
        .is_err());
        let amount: f64 = conn
            .query_row("SELECT amount FROM transactions WHERE id = 1", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(amount, 2500.0);
    }
}
