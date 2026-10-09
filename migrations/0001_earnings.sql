CREATE TABLE IF NOT EXISTS earnings_spots (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS earnings_entries (
 id TEXT PRIMARY KEY, date TEXT NOT NULL, spot_id TEXT NOT NULL REFERENCES earnings_spots(id),
 version INTEGER NOT NULL DEFAULT 1, payload TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS earnings_by_date ON earnings_entries(date);
CREATE INDEX IF NOT EXISTS earnings_by_spot_date ON earnings_entries(spot_id,date);
CREATE TABLE IF NOT EXISTS earnings_rates (date TEXT PRIMARY KEY, payload TEXT NOT NULL, fetched_at TEXT NOT NULL);
