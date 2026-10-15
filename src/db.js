const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'gym.db');
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);

// Enable Foreign Key constraints and WAL mode for high performance & ACID safety
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('member', 'admin')) DEFAULT 'member',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    hour INTEGER NOT NULL CHECK(hour >= 0 AND hour <= 23),
    starts_at INTEGER NOT NULL UNIQUE,
    capacity INTEGER NOT NULL DEFAULT 20,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK(status IN ('confirmed', 'cancelled')) DEFAULT 'confirmed',
    code TEXT NOT NULL UNIQUE,
    checked_in_at INTEGER NULL,
    created_at INTEGER NOT NULL
  );

  -- Enforces at the database engine level: max 1 active booking per member per session
  CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_booking_per_user_session
    ON bookings(session_id, user_id) WHERE status = 'confirmed';

  CREATE TABLE IF NOT EXISTS waitlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    UNIQUE(session_id, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_starts_at ON sessions(starts_at);
  CREATE INDEX IF NOT EXISTS idx_bookings_session_status ON bookings(session_id, status);
  CREATE INDEX IF NOT EXISTS idx_bookings_code ON bookings(code);
  CREATE INDEX IF NOT EXISTS idx_waitlist_session_created ON waitlist(session_id, created_at);
`);

module.exports = db;
