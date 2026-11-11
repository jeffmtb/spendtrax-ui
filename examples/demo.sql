-- Entirely fictional records. Run schema.sql first in a new database.
INSERT INTO transactions
    (transaction_date, year, description, category, amount, retirement, account, check_number)
VALUES
    ('2026-01-15', 2026, 'Example paycheck', 'Income', 2500.00, 0, 'Demo checking', NULL),
    ('2026-01-16', 2026, 'Example grocery shop', 'Groceries', -62.35, 0, 'Demo checking', NULL),
    ('2026-01-20', 2026, 'Example retirement contribution', 'Savings', -200.00, 1, 'Demo savings', NULL);
