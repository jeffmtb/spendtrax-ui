-- Compatible with SpendTrax UI. This file contains no personal data.
CREATE TABLE transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_date DATE NOT NULL,
    year INTEGER NOT NULL,
    description TEXT NOT NULL,
    category TEXT,
    amount DECIMAL(10,2) NOT NULL,
    retirement BOOLEAN NOT NULL,
    account TEXT NOT NULL,
    check_number TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
