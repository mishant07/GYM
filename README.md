# Twenty · Gym Slot Booking System

A robust, production-ready gym session booking and check-in system designed to eliminate overbooking and door arguments. Built with a full relational backend, atomic transaction locking, automated waitlist promotions, and a live reactive web interface.

---

## Design Note (Stack & Data Model)

> **Stack:** Node.js, Express, SQLite (`better-sqlite3`), and Vanilla JS/CSS for a zero-build, ultra-fast frontend.  
> **Data Model:** Four relational tables (`users`, `sessions`, `bookings`, `waitlist`) connected with enforced foreign keys and cascading rules.  
> **Concurrency:** Atomic SQLite transactions (`BEGIN IMMEDIATE`) serialize seat acquisition so that 20 mats never becomes 21, even under simultaneous parallel requests.  
> **Integrity:** A partial unique index on `bookings(session_id, user_id) WHERE status = 'confirmed'` guarantees one active seat per member while permitting cancellation and rebooking.  
> **Waitlist Promotion:** Cancellations trigger an atomic check: if the session has not started, the earliest waitlisted member (`ORDER BY created_at ASC LIMIT 1`) is instantly booked and assigned a cryptographic check-in code.  
> **Security:** Passwords hashed with bcrypt; stateless JWT bearer authentication; server-side role and ownership verification on all private endpoints.

---

## Test Credentials

The database comes pre-seeded with test data spanning multiple days, including an **in-progress live session** and a **full session with a waitlist**.

| Role | Name | Email | Password | Pre-configured State |
| :--- | :--- | :--- | :--- | :--- |
| **Admin** | Gym Admin | `admin@gym.test` | `AdminPass123` | Can create sessions, view all member bookings, and check in codes |
| **Member** | Alice Member | `alice@gym.test` | `MemberPass123` | Has a confirmed booking in today's **live session** (ready to test check-in) |
| **Member** | Bob Member | `bob@gym.test` | `MemberPass123` | Waitlisted at **Position #1** in tomorrow's 18:00 full session |
| **Member (extra)** | Priya Shah | `priya.shah@gym.test` | `MemberPass123` | General member |

*(Quick-login buttons for Admin, Alice, and Bob are also built directly into the login screen).*

---

## Assumptions & Design Decisions

Where the brief allowed decisions, the following choices were made:
1. **Check-in Window:** Codes work strictly during the session's active hour (`starts_at <= now < starts_at + 1 hour`). Expired or future sessions reject check-in with `409 outside_session_hour`.
2. **Code Cryptography:** Booking codes are 6 uppercase alphanumeric characters drawn from a 32-character unambiguous alphabet (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, excluding 0/O, 1/I/L to avoid check-in transcription errors). Over 1.07 billion unguessable combinations.
3. **Waitlist Promotion Cutoff:** If a cancellation happens after a session has already started, no waitlist promotion occurs ("Nobody is promoted into a session that has already started").
4. **Admin Account Creation:** Per spec, `/api/auth/register` exclusively provisions `member` accounts. Admins can only be created via database seeds or administrative DB scripts.
5. **Client-Server Contract:** Seat counts update optimistically in the browser for instant user feedback and immediately roll back if the server returns a conflict (e.g. `409 session_full`). Polling runs every 5 seconds to keep all open tabs synchronized.

---

## Quick Start

### 1. Requirements
- Node.js (v18, v20, v22, or v24)
- npm

### 2. Installation
```bash
git clone https://github.com/mishant07/GYM-SESSION.git
cd GYM-SESSION
npm install
```

### 3. Run Automated Tests
Runs the complete test suite verifying auth, route guards, capacity limits, waitlist promotions, check-in, and concurrency race conditions:
```bash
npm test
```

### 4. Start the Application
```bash
npm start
```
Open your browser to: **[http://localhost:3000](http://localhost:3000)**

*(The SQLite database `gym.db` will automatically initialize and seed itself on first run).*

---

## API Specification

All endpoints validate input independently on the server, return standard HTTP status codes (`400/422`, `401`, `403`, `404`, `409`), and format errors consistently:

```json
{
  "code": "session_full",
  "message": "This session is full. Someone just took the last mat.",
  "details": {}
}
```

### Authentication
- `POST /api/auth/register` — Register new member (`name`, `email`, `password`). Returns JWT token.
- `POST /api/auth/login` — Log in with `email` and `password`. Returns JWT token and user info.
- `GET /api/auth/me` — Return current authenticated user profile.

### Sessions & Bookings
- `GET /api/sessions?date=YYYY-MM-DD` — List sessions with live seats left, waitlist count, and current user status.
- `POST /api/sessions` — Admin only: Create a new hourly session (`date`, `hour`).
- `POST /api/sessions/:id/bookings` — Book a mat in an open session. Returns confirmed booking & 6-character code.
- `DELETE /api/bookings/:id` — Cancel an upcoming booking. Automatically promotes the first waitlisted user.
- `POST /api/sessions/:id/waitlist` — Join waitlist when session is at capacity (20/20).
- `DELETE /api/sessions/:id/waitlist` — Leave waitlist.
- `GET /api/bookings/mine` — Retrieve current user's upcoming bookings, codes, past bookings, and waitlist positions.

### Admin Operations
- `GET /api/admin/sessions/:id/bookings` — Admin only: Full attendee roster, codes, and attendance states.
- `POST /api/admin/checkin` — Admin only: Validate 6-character booking code at the door and mark member present.

---

## Concurrency & The 20-Seat Guarantee

To strictly satisfy the requirement:
> *"A session never exceeds 20 confirmed bookings, even when two people take the last seat at the same moment."*

The booking handler executes within a SQLite transaction:
```javascript
const bookSessionTx = db.transaction(() => {
  // 1. Verify session exists and has not started
  // 2. Count active confirmed bookings
  // 3. If count >= 20 -> throw 409 session_full
  // 4. Generate CSPRNG code and insert confirmed booking
});
```
Because SQLite serializes write transactions and Node executes the transaction body synchronously, parallel HTTP threads cannot interleave reads and writes. The test suite includes a parallel concurrency test simulating two simultaneous requests taking the 20th mat, asserting that exactly one succeeds and one receives 409.

---

## Deployment (Docker / Render / Railway)

A production `Dockerfile` is included:
```bash
docker build -t gym-booking .
docker run -p 3000:3000 gym-booking
```
Can be deployed to any Docker-compatible host (Render Web Service, Railway, Fly.io, or DigitalOcean App Platform).
