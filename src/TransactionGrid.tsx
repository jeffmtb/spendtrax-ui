import { useEffect, useState, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import ThemeSelector from "./ThemeSelector";
import {
  DataGrid,
  GridColDef,
  GridRowModel,
  GridFooter,
  useGridApiContext,
  useGridSelector,
  gridFilteredSortedRowEntriesSelector,
} from "@mui/x-data-grid";
import {
  Box,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  Typography,
  Paper,
  Alert,
  CircularProgress,
  Chip,
  SelectChangeEvent,
} from "@mui/material";

// Transaction type matching Rust struct
interface Transaction {
  id: number;
  transaction_date: string;
  year: number;
  description: string;
  category: string | null;
  amount: number;
  retirement: boolean;
  account: string;
  check_number: string | null;
}

interface TransactionUpdate {
  id: number;
  transaction_date: string;
  description: string;
  category: string | null;
  amount: number;
  retirement: boolean;
  account: string;
  check_number: string | null;
}

// Subscribe inside the grid so the summary follows column filters and edits,
// including an empty result set, across all pages.
export function TransactionFooter() {
  const apiRef = useGridApiContext();
  const rows = useGridSelector(apiRef, gridFilteredSortedRowEntriesSelector);
  const total = rows.reduce((sum, { model }) => sum + model.amount, 0);

  return (
    <Box>
      <GridFooter />
      <Box sx={{ p: 2, display: "flex", justifyContent: "space-between", gap: 2 }}>
        <Typography variant="body2" color="text.secondary">
          {rows.length} matching transactions across all pages
        </Typography>
        <Typography variant="h6" fontWeight="bold">
          Total:{" "}
          <Box component="span" sx={{ color: total < 0 ? "error.main" : "success.main" }}>
            {total.toLocaleString("en-US", { style: "currency", currency: "USD" })}
          </Box>
        </Typography>
      </Box>
    </Box>
  );
}

export default function TransactionGrid() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [editedRows, setEditedRows] = useState<Map<number, Transaction>>(new Map());
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dbStatus, setDbStatus] = useState<string | null>(null);

  // Filter options
  const [years, setYears] = useState<number[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [accounts, setAccounts] = useState<string[]>([]);

  // Selected filters
  const [selectedYear, setSelectedYear] = useState<string>("all");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedAccount, setSelectedAccount] = useState<string>("all");

  // Load database and transactions on mount
  useEffect(() => {
    initializeApp();
  }, []);

  const initializeApp = async () => {
    try {
      setLoading(true);
      setError(null);

      // Try to initialize database
      const dbPath = await invoke<string | null>("initialize_database");

      if (dbPath) {
        setDbStatus(dbPath);
        await loadAllData();
      } else {
        // No database found, prompt user to select
        setDbStatus(null);
        setLoading(false);
      }
    } catch (err) {
      setError(`Failed to initialize: ${err}`);
      setLoading(false);
    }
  };

  const loadAllData = async () => {
    const [transactionsData, yearsData, categoriesData, accountsData] =
      await Promise.all([
        invoke<Transaction[]>("get_all_transactions"),
        invoke<number[]>("get_unique_years"),
        invoke<string[]>("get_unique_categories"),
        invoke<string[]>("get_unique_accounts"),
      ]);

    setTransactions(transactionsData);
    setYears(yearsData);
    setCategories(categoriesData);
    setAccounts(accountsData);
    setError(null);
    setLoading(false);
  };

  const handleSelectDatabase = async () => {
    if (loading || isEditing) return;
    if (editedRows.size > 0) {
      setError("Save or discard your changes before switching databases.");
      return;
    }

    setLoading(true);
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "SQLite Database", extensions: ["db", "sqlite", "sqlite3"] }],
      });

      if (typeof selected === "string") {
        await invoke("set_database_path", { path: selected });
        setDbStatus(selected);
        // Do not leave the previous database's rows editable if loading fails.
        setTransactions([]);
        setEditedRows(new Map());
        setYears([]);
        setCategories([]);
        setAccounts([]);
        setSelectedYear("all");
        setSelectedCategory("all");
        setSelectedAccount("all");
        await loadAllData();
      }
    } catch (err) {
      setError(`Failed to open database: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  // Filter transactions based on selections
  const filteredTransactions = useMemo(() => {
    const filtered = transactions.filter((t) => {
      // Year filter
      if (selectedYear !== "all") {
        const yearNum = parseInt(selectedYear, 10);
        if (t.year !== yearNum) {
          return false;
        }
      }
      // Category filter
      if (selectedCategory !== "all") {
        if (t.category !== selectedCategory) {
          return false;
        }
      }
      // Account filter
      if (selectedAccount !== "all") {
        if (t.account !== selectedAccount) {
          return false;
        }
      }
      return true;
    });

    return filtered;
  }, [transactions, selectedYear, selectedCategory, selectedAccount]);

  // Handle row edit
  const processRowUpdate = useCallback(
    (newRow: GridRowModel, _oldRow: GridRowModel) => {
      const date = newRow.transaction_date as string;
      const parsed = new Date(`${date}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith("0000-") ||
          !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
        throw new Error("Enter a valid date in YYYY-MM-DD format.");
      }
      const updatedTransaction = { ...newRow, year: Number(date.slice(0, 4)) } as Transaction;

      // Track the edited row
      setEditedRows((prev) => {
        const updated = new Map(prev);
        updated.set(updatedTransaction.id, updatedTransaction);
        return updated;
      });

      // Update local state
      setTransactions((prev) =>
        prev.map((t) => (t.id === updatedTransaction.id ? updatedTransaction : t))
      );

      return updatedTransaction;
    },
    []
  );

  // Save all edited rows to database
  const handleSaveChanges = async () => {
    if (loading || isEditing || editedRows.size === 0 || !dbStatus) return;

    try {
      setLoading(true);
      const updates: TransactionUpdate[] = Array.from(editedRows.values()).map(
        (t) => ({
          id: t.id,
          transaction_date: t.transaction_date,
          description: t.description,
          category: t.category,
          amount: t.amount,
          retirement: t.retirement,
          account: t.account,
          check_number: t.check_number,
        })
      );

      await invoke("update_transactions_batch", {
        transactions: updates,
        expectedDatabasePath: dbStatus,
      });
      setEditedRows(new Map());
      setError(null);

      // Reload data to ensure consistency
      await loadAllData();
    } catch (err) {
      setError(`Failed to save changes: ${err}`);
      setLoading(false);
    }
  };

  // Discard changes
  const handleDiscardChanges = async () => {
    if (loading || isEditing) return;
    setLoading(true);
    try {
      await loadAllData();
      setEditedRows(new Map());
    } catch (err) {
      setError(`Failed to discard changes: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  // Column definitions
  const columns: GridColDef[] = [
    {
      field: "transaction_date",
      headerName: "Date",
      width: 120,
      editable: true,
    },
    {
      field: "description",
      headerName: "Description",
      width: 300,
      editable: true,
    },
    {
      field: "category",
      headerName: "Category",
      width: 180,
      editable: true,
      type: "singleSelect",
      valueOptions: categories,
    },
    {
      field: "amount",
      headerName: "Amount",
      width: 120,
      editable: true,
      type: "number",
      valueFormatter: (value: number) => {
        return value?.toLocaleString("en-US", {
          style: "currency",
          currency: "USD",
        });
      },
    },
    {
      field: "account",
      headerName: "Account",
      width: 180,
      editable: true,
      type: "singleSelect",
      valueOptions: accounts,
    },
    {
      field: "retirement",
      headerName: "Retirement",
      width: 100,
      editable: true,
      type: "boolean",
    },
    {
      field: "check_number",
      headerName: "Check #",
      width: 100,
      editable: true,
    },
    {
      field: "year",
      headerName: "Year",
      width: 80,
    },
  ];

  // Show database selection if no database loaded
  if (!dbStatus && !loading) {
    return (
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          boxSizing: "border-box",
          position: "relative",
          gap: 2,
          p: 4,
        }}
      >
        <Box sx={{ position: "absolute", top: 0, right: 0 }}>
          <ThemeSelector />
        </Box>
        {error && <Alert severity="error">{error}</Alert>}
        <Typography variant="h5">No Database Found</Typography>
        <Typography variant="body1" color="text.secondary">
          Please select your spendtrax.db file to continue.
        </Typography>
        <Button variant="contained" onClick={handleSelectDatabase}>
          Select Database File
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0, gap: 2 }}>
      {/* Error Alert */}
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Filters Row */}
      <Paper sx={{ p: 2, display: "flex", gap: 2, flexWrap: "wrap", alignItems: "center", flexShrink: 0 }}>
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel>Year</InputLabel>
          <Select
            value={selectedYear}
            label="Year"
            onChange={(e: SelectChangeEvent) => setSelectedYear(e.target.value)}
          >
            <MenuItem value="all">All Years</MenuItem>
            {years.map((year) => (
              <MenuItem key={year} value={year.toString()}>
                {year}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel>Category</InputLabel>
          <Select
            value={selectedCategory}
            label="Category"
            onChange={(e: SelectChangeEvent) => setSelectedCategory(e.target.value)}
          >
            <MenuItem value="all">All Categories</MenuItem>
            {categories.map((category) => (
              <MenuItem key={category} value={category}>
                {category}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel>Account</InputLabel>
          <Select
            value={selectedAccount}
            label="Account"
            onChange={(e: SelectChangeEvent) => setSelectedAccount(e.target.value)}
          >
            <MenuItem value="all">All Accounts</MenuItem>
            {accounts.map((account) => (
              <MenuItem key={account} value={account}>
                {account}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* Change Indicators and Save/Discard Buttons */}
        <Box sx={{ display: "flex", gap: 1, ml: "auto", alignItems: "center" }}>
          {editedRows.size > 0 && (
            <>
              <Chip
                label={`${editedRows.size} unsaved change${editedRows.size > 1 ? "s" : ""}`}
                color="warning"
                size="small"
              />
              <Button
                variant="contained"
                color="primary"
                onClick={handleSaveChanges}
                disabled={loading || isEditing}
              >
                Save Changes
              </Button>
              <Button
                variant="outlined"
                color="secondary"
                onClick={handleDiscardChanges}
                disabled={loading || isEditing}
              >
                Discard
              </Button>
            </>
          )}
        </Box>
        <ThemeSelector />
      </Paper>

      {/* Data Grid */}
      <Paper sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden" }}>
        {loading ? (
          <Box
            sx={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              height: "100%",
            }}
          >
            <CircularProgress />
          </Box>
        ) : (
          <DataGrid
            key={dbStatus}
            slots={{ footer: TransactionFooter }}
            rows={filteredTransactions}
            columns={columns}
            processRowUpdate={processRowUpdate}
            onCellEditStart={() => setIsEditing(true)}
            onCellEditStop={() => setIsEditing(false)}
            onProcessRowUpdateError={(error) => {
              setError(`Edit error: ${error}`);
              setIsEditing(true);
            }}
            pageSizeOptions={[25, 50, 100]}
            initialState={{
              pagination: { paginationModel: { pageSize: 100 } },
              sorting: { sortModel: [{ field: "transaction_date", sort: "desc" }] },
            }}
            disableRowSelectionOnClick
            sx={{ border: 0 }}
          />
        )}
      </Paper>

      {/* Database Path Info */}
      {dbStatus && (
        <Typography variant="caption" color="text.secondary" sx={{ px: 1, flexShrink: 0, overflowWrap: "anywhere" }}>
          Database: {dbStatus}
          <Button size="small" onClick={handleSelectDatabase} disabled={loading || isEditing || editedRows.size > 0} sx={{ ml: 1 }}>
            Change
          </Button>
          {editedRows.size > 0 && "Save or discard changes to switch databases."}
        </Typography>
      )}
    </Box>
  );
}
