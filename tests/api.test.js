const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const fs = require('fs');

// Set test environment before requiring app
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(__dirname, 'test.db');
process.env.JWT_SECRET = 'test_jwt_secret_key_123456';

const app = require('../server');
const db = require('../src/db');
const { generateBookingCode, formatDate, getSessionTimestamp } = require('../src/utils');

let server;
let baseUrl;

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const headers = options.headers || {};
    let body = options.body;

    if (body && typeof body === 'object') {
      body = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }

    const req = http.request(
      url,
      {
        method: options.method || 'GET',
        headers
      },
      (res) => {
        let rawData = '';
        res.on('data', (chunk) => (rawData += chunk));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(rawData);
          } catch {
            json = rawData;
          }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: json
          });
        });
      }
    );

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

describe('Gym Slot Booking System - Complete Test Suite', () => {
  let adminToken;
  let aliceToken;
  let bobToken;
  let testSessionId;
  let fullSessionId;

  before((_, done) => {
    // Re-seed clean test db
    db.exec(`
      DELETE FROM waitlist;
      DELETE FROM bookings;
      DELETE FROM sessions;
      DELETE FROM users;
    `);

    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      done();
    });
  });

  after((_, done) => {
    server.close(() => {
      try {
        if (fs.existsSync(process.env.DB_PATH)) {
          fs.unlinkSync(process.env.DB_PATH);
        }
      } catch {}
      done();
    });
  });

  test('1. Auth: Register member and prevent duplicate email', async () => {
    // Register Alice
    const regRes = await request('/api/auth/register', {
      method: 'POST',
      body: {
        name: 'Alice Member',
        email: 'alice@gym.test',
        password: 'MemberPass123'
      }
    });
    assert.equal(regRes.status, 201);
    assert.ok(regRes.body.token);
    assert.equal(regRes.body.user.role, 'member');
    aliceToken = regRes.body.token;

    // Duplicate email fails with 409
    const dupRes = await request('/api/auth/register', {
      method: 'POST',
      body: {
        name: 'Alice Clone',
        email: 'alice@gym.test',
        password: 'MemberPass123'
      }
    });
    assert.equal(dupRes.status, 409);
    assert.equal(dupRes.body.code, 'email_taken');

    // Register Bob
    const bobRes = await request('/api/auth/register', {
      method: 'POST',
      body: {
        name: 'Bob Member',
        email: 'bob@gym.test',
        password: 'MemberPass123'
      }
    });
    assert.equal(bobRes.status, 201);
    bobToken = bobRes.body.token;

    // Directly insert admin into DB (rule: Admin accounts are created directly in database, never through registration)
    const bcrypt = require('bcryptjs');
    db.prepare(`
      INSERT INTO users (name, email, password_hash, role, created_at)
      VALUES (?, ?, ?, 'admin', ?)
    `).run('Gym Admin', 'admin@gym.test', bcrypt.hashSync('AdminPass123', 10), Date.now());

    // Admin login
    const adminLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { email: 'admin@gym.test', password: 'AdminPass123' }
    });
    assert.equal(adminLogin.status, 200);
    assert.equal(adminLogin.body.user.role, 'admin');
    adminToken = adminLogin.body.token;
  });

  test('2. Authorization: Members cannot access admin routes (403 Forbidden)', async () => {
    const memberTryAdmin = await request('/api/admin/sessions/1/bookings', {
      headers: { Authorization: `Bearer ${aliceToken}` }
    });
    assert.equal(memberTryAdmin.status, 403);
    assert.equal(memberTryAdmin.body.code, 'forbidden');
  });

  test('3. Sessions: Admin creates future session, rejects conflicting slot', async () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 2);
    const dateStr = formatDate(futureDate.getTime());

    // Success creation
    const createRes = await request('/api/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { date: dateStr, hour: 10 }
    });
    assert.equal(createRes.status, 201);
    assert.equal(createRes.body.session.capacity, 20);
    testSessionId = createRes.body.session.id;

    // Rejects duplicate slot
    const dupRes = await request('/api/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { date: dateStr, hour: 10 }
    });
    assert.equal(dupRes.status, 409);
    assert.equal(dupRes.body.code, 'slot_taken');
  });

  test('4. Booking: Member books mat, gets 6-char code, and cannot double book', async () => {
    const bookRes = await request(`/api/sessions/${testSessionId}/bookings`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${aliceToken}` }
    });
    assert.equal(bookRes.status, 201);
    assert.ok(bookRes.body.booking.code);
    assert.equal(bookRes.body.booking.code.length, 6);

    // Double booking returns 409
    const doubleBook = await request(`/api/sessions/${testSessionId}/bookings`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${aliceToken}` }
    });
    assert.equal(doubleBook.status, 409);
    assert.equal(doubleBook.body.code, 'already_booked');
  });

  test('5. Capacity & Waitlist: Full session (20 mats) rejects 21st and routes to waitlist', async () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 3);
    const dateStr = formatDate(futureDate.getTime());

    const sRes = await request('/api/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { date: dateStr, hour: 14 }
    });
    fullSessionId = sRes.body.session.id;

    // Fill 19 seats with dummy users
    const bcrypt = require('bcryptjs');
    const dummyHash = bcrypt.hashSync('Pass123', 4);
    for (let i = 1; i <= 19; i++) {
      const uRes = db.prepare(`
        INSERT INTO users (name, email, password_hash, role, created_at)
        VALUES (?, ?, ?, 'member', ?)
      `).run(`User ${i}`, `user${i}@gym.test`, dummyHash, Date.now());

      db.prepare(`
        INSERT INTO bookings (session_id, user_id, status, code, created_at)
        VALUES (?, ?, 'confirmed', ?, ?)
      `).run(fullSessionId, uRes.lastInsertRowid, generateBookingCode(), Date.now());
    }

    // Alice books the 20th mat (session is now 20/20 full)
    const aliceTakeLast = await request(`/api/sessions/${fullSessionId}/bookings`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${aliceToken}` }
    });
    assert.equal(aliceTakeLast.status, 201);

    // Bob tries to book the 21st seat -> 409 session_full
    const bobRejected = await request(`/api/sessions/${fullSessionId}/bookings`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bobToken}` }
    });
    assert.equal(bobRejected.status, 409);
    assert.equal(bobRejected.body.code, 'session_full');

    // Bob joins waitlist -> gets position 1
    const bobWaitlist = await request(`/api/sessions/${fullSessionId}/waitlist`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bobToken}` }
    });
    assert.equal(bobWaitlist.status, 200);
    assert.equal(bobWaitlist.body.session.waitlist_position, 1);
  });

  test('6. Cancellation & Auto-Promotion: When someone cancels, waitlisted user is booked automatically', async () => {
    // Check Alice's booking ID
    const myBookings = await request('/api/bookings/mine', {
      headers: { Authorization: `Bearer ${aliceToken}` }
    });
    const aliceFullBooking = myBookings.body.bookings.find((b) => b.session_id === fullSessionId);
    assert.ok(aliceFullBooking);

    // Alice cancels her booking
    const cancelRes = await request(`/api/bookings/${aliceFullBooking.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${aliceToken}` }
    });
    assert.equal(cancelRes.status, 200);
    assert.equal(cancelRes.body.cancelled, true);

    // Verify Bob is now AUTOMATICALLY promoted from waitlist to confirmed booking!
    const bobBookings = await request('/api/bookings/mine', {
      headers: { Authorization: `Bearer ${bobToken}` }
    });
    const bobPromoted = bobBookings.body.bookings.find((b) => b.session_id === fullSessionId);
    assert.ok(bobPromoted, 'Bob should have received an automatic confirmed booking');
    assert.equal(bobPromoted.status, 'confirmed');
    assert.ok(bobPromoted.code);
    assert.equal(bobBookings.body.waitlist.length, 0, 'Bob should no longer be on the waitlist');
  });

  test('7. Check-in: Admin checks in with code during live session hour', async () => {
    // Create a live session starting at current hour
    const now = new Date();
    const curHour = now.getHours();
    now.setMinutes(0, 0, 0);
    const startsAt = now.getTime();
    const todayStr = formatDate(startsAt);

    const sInsert = db.prepare(`
      INSERT INTO sessions (date, hour, starts_at, capacity, created_at)
      VALUES (?, ?, ?, 20, ?)
    `).run(todayStr, curHour, startsAt, Date.now());
    const liveSessionId = sInsert.lastInsertRowid;

    // Alice user ID
    const aliceUser = db.prepare(`SELECT id FROM users WHERE email = 'alice@gym.test'`).get();

    // Alice is booked in this live session
    const aliceCode = '7XKP2Q';
    db.prepare(`
      INSERT INTO bookings (session_id, user_id, status, code, created_at)
      VALUES (?, ?, 'confirmed', ?, ?)
    `).run(liveSessionId, aliceUser.id, aliceCode, Date.now());

    // Admin checks in Alice with code 7XKP2Q
    const checkinRes = await request('/api/admin/checkin', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { code: '7XKP2Q' }
    });
    assert.equal(checkinRes.status, 200);
    assert.equal(checkinRes.body.member.name, 'Alice Member');

    // Code cannot be used twice (409 already_checked_in)
    const checkinAgain = await request('/api/admin/checkin', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { code: '7XKP2Q' }
    });
    assert.equal(checkinAgain.status, 409);
    assert.equal(checkinAgain.body.code, 'already_checked_in');
  });

  test('8. Concurrency / Race Conditions: Two concurrent requests cannot overbook the 20th mat', async () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 4);
    const dateStr = formatDate(futureDate.getTime());

    const raceSess = db.prepare(`
      INSERT INTO sessions (date, hour, starts_at, capacity, created_at)
      VALUES (?, 16, ?, 20, ?)
    `).run(dateStr, getSessionTimestamp(dateStr, 16), Date.now());
    const raceSessionId = raceSess.lastInsertRowid;

    // Create 19 dummy users
    const bcrypt = require('bcryptjs');
    const dummyHash = bcrypt.hashSync('Pass123', 4);
    for (let i = 1; i <= 19; i++) {
      const uRes = db.prepare(`
        INSERT INTO users (name, email, password_hash, role, created_at)
        VALUES (?, ?, ?, 'member', ?)
      `).run(`Race User ${i}`, `race${i}_${Date.now()}@gym.test`, dummyHash, Date.now());

      db.prepare(`
        INSERT INTO bookings (session_id, user_id, status, code, created_at)
        VALUES (?, ?, 'confirmed', ?, ?)
      `).run(raceSessionId, uRes.lastInsertRowid, generateBookingCode(), Date.now());
    }

    // Two users simultaneously attempt to book the final (20th) mat
    const [resAlice, resBob] = await Promise.all([
      request(`/api/sessions/${raceSessionId}/bookings`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${aliceToken}` }
      }),
      request(`/api/sessions/${raceSessionId}/bookings`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bobToken}` }
      })
    ]);

    const statuses = [resAlice.status, resBob.status].sort();
    assert.deepEqual(statuses, [201, 409], 'Exactly one request must succeed with 201 and one must fail with 409');

    // Verify total confirmed count in database is exactly 20 (never 21)
    const count = db.prepare(`
      SELECT COUNT(*) AS count FROM bookings
      WHERE session_id = ? AND status = 'confirmed'
    `).get(raceSessionId).count;
    assert.equal(count, 20, 'Session confirmed count must never exceed 20');
  });
});
