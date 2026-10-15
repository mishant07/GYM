const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { generateBookingCode, formatDate, getSessionTimestamp } = require('./utils');
const { AppError, generateToken, authenticateToken, requireAdmin } = require('./middleware');

const router = express.Router();
const ONE_HOUR_MS = 60 * 60 * 1000;

// Helper to compute a standardized session view for a user
function getSessionView(session, userId, now = Date.now()) {
  const countRow = db.prepare(`
    SELECT COUNT(*) AS count FROM bookings
    WHERE session_id = ? AND status = 'confirmed'
  `).get(session.id);
  const confirmedCount = countRow ? countRow.count : 0;
  const seatsLeft = Math.max(0, session.capacity - confirmedCount);

  let myBooking = null;
  if (userId) {
    const b = db.prepare(`
      SELECT id, code, status FROM bookings
      WHERE session_id = ? AND user_id = ? AND status = 'confirmed'
      LIMIT 1
    `).get(session.id, userId);
    if (b) {
      myBooking = { id: b.id, code: b.code };
    }
  }

  const waitlistRows = db.prepare(`
    SELECT user_id FROM waitlist
    WHERE session_id = ?
    ORDER BY created_at ASC
  `).all(session.id);

  let waitlistPosition = null;
  if (userId) {
    const idx = waitlistRows.findIndex((w) => w.user_id === userId);
    if (idx >= 0) {
      waitlistPosition = idx + 1;
    }
  }

  const isStarted = session.starts_at <= now && now < session.starts_at + ONE_HOUR_MS;
  const isEnded = session.starts_at + ONE_HOUR_MS <= now;

  return {
    id: session.id,
    date: session.date,
    hour: session.hour,
    starts_at: session.starts_at,
    capacity: session.capacity,
    seats_left: seatsLeft,
    started: isStarted,
    ended: isEnded,
    my_booking: myBooking,
    waitlist_position: waitlistPosition,
    waitlist_size: waitlistRows.length
  };
}

// ==========================================
// AUTHENTICATION
// ==========================================

router.post('/auth/register', (req, res, next) => {
  try {
    const { name, email, password } = req.body || {};
    const errors = {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      errors.name = 'Enter your name.';
    }
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      errors.email = 'Enter a valid email address.';
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      errors.password = 'Use at least 8 characters.';
    }

    if (Object.keys(errors).length > 0) {
      throw new AppError(422, 'validation_error', 'Invalid registration details.', errors);
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
    if (existing) {
      throw new AppError(409, 'email_taken', 'That email is already registered.', { email: 'That email is already registered.' });
    }

    const hash = bcrypt.hashSync(password, 10);
    const insertRes = db.prepare(`
      INSERT INTO users (name, email, password_hash, role, created_at)
      VALUES (?, ?, ?, 'member', ?)
    `).run(name.trim(), cleanEmail, hash, Date.now());

    const user = {
      id: Number(insertRes.lastInsertRowid),
      name: name.trim(),
      email: cleanEmail,
      role: 'member'
    };

    const token = generateToken(user);
    res.status(201).json({ token, user });
  } catch (err) {
    next(err);
  }
});

router.post('/auth/login', (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      throw new AppError(400, 'validation_error', 'Email and password are required.');
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      throw new AppError(401, 'invalid_credentials', 'Incorrect email or password.');
    }

    const safeUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    };

    const token = generateToken(safeUser);
    res.json({ token, user: safeUser });
  } catch (err) {
    next(err);
  }
});

router.get('/auth/me', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

// ==========================================
// SESSIONS
// ==========================================

router.get('/sessions', authenticateToken, (req, res, next) => {
  try {
    const { date, all } = req.query;
    const now = Date.now();

    let query = 'SELECT * FROM sessions';
    const params = [];

    if (all === '1' || all === 'true') {
      query += ' ORDER BY starts_at ASC';
    } else if (date) {
      query += ' WHERE date = ? ORDER BY starts_at ASC';
      params.push(date);
    } else {
      query += ' WHERE starts_at + ? > ? ORDER BY starts_at ASC';
      params.push(ONE_HOUR_MS, now);
    }

    const sessions = db.prepare(query).all(...params);
    const result = sessions.map((s) => getSessionView(s, req.user.id, now));

    res.json({ sessions: result });
  } catch (err) {
    next(err);
  }
});

router.post('/sessions', authenticateToken, requireAdmin, (req, res, next) => {
  try {
    const { date, hour } = req.body || {};
    const parsedHour = Number(hour);
    const errors = {};

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      errors.date = 'Choose a valid date in YYYY-MM-DD format.';
    }
    if (hour === undefined || hour === null || !Number.isInteger(parsedHour) || parsedHour < 0 || parsedHour > 23) {
      errors.hour = 'Enter a valid whole hour between 0 and 23.';
    }

    if (Object.keys(errors).length > 0) {
      throw new AppError(422, 'validation_error', 'Validation failed.', errors);
    }

    const startsAt = getSessionTimestamp(date, parsedHour);
    if (startsAt <= Date.now()) {
      throw new AppError(422, 'validation_error', 'Session must start in the future.', { date: 'Session must start in the future.' });
    }

    const existing = db.prepare('SELECT id FROM sessions WHERE starts_at = ?').get(startsAt);
    if (existing) {
      throw new AppError(409, 'slot_taken', 'A session already starts at that time.');
    }

    const insertRes = db.prepare(`
      INSERT INTO sessions (date, hour, starts_at, capacity, created_at)
      VALUES (?, ?, ?, 20, ?)
    `).run(date, parsedHour, startsAt, Date.now());

    const session = {
      id: Number(insertRes.lastInsertRowid),
      date,
      hour: parsedHour,
      starts_at: startsAt,
      capacity: 20
    };

    res.status(201).json({ session });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// BOOKINGS & WAITLIST
// ==========================================

router.post('/sessions/:id/bookings', authenticateToken, (req, res, next) => {
  try {
    const sessionId = Number(req.params.id);
    const userId = req.user.id;
    const now = Date.now();

    // Atomic SQLite Transaction ensures serialized booking without concurrency gaps
    const bookSessionTx = db.transaction(() => {
      const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
      if (!session) {
        throw new AppError(404, 'not_found', 'Session not found.');
      }

      if (session.starts_at <= now) {
        throw new AppError(409, 'session_started', 'This session has already started or ended.');
      }

      const existingBooking = db.prepare(`
        SELECT id FROM bookings
        WHERE session_id = ? AND user_id = ? AND status = 'confirmed'
      `).get(sessionId, userId);
      if (existingBooking) {
        throw new AppError(409, 'already_booked', 'You already have a booking for this session.');
      }

      const countRow = db.prepare(`
        SELECT COUNT(*) AS count FROM bookings
        WHERE session_id = ? AND status = 'confirmed'
      `).get(sessionId);

      if (countRow.count >= session.capacity) {
        throw new AppError(409, 'session_full', 'This session is full. Someone just took the last mat.');
      }

      // Generate unique code with CSPRNG
      let code = generateBookingCode();
      while (db.prepare('SELECT id FROM bookings WHERE code = ?').get(code)) {
        code = generateBookingCode();
      }

      const insertRes = db.prepare(`
        INSERT INTO bookings (session_id, user_id, status, code, checked_in_at, created_at)
        VALUES (?, ?, 'confirmed', ?, NULL, ?)
      `).run(sessionId, userId, code, now);

      // If user was on the waitlist, remove them
      db.prepare('DELETE FROM waitlist WHERE session_id = ? AND user_id = ?').run(sessionId, userId);

      return {
        id: Number(insertRes.lastInsertRowid),
        session_id: sessionId,
        user_id: userId,
        status: 'confirmed',
        code,
        checked_in_at: null
      };
    });

    const booking = bookSessionTx();
    res.status(201).json({ booking });
  } catch (err) {
    next(err);
  }
});

router.delete('/bookings/:id', authenticateToken, (req, res, next) => {
  try {
    const bookingId = Number(req.params.id);
    const userId = req.user.id;
    const isAdmin = req.user.role === 'admin';
    const now = Date.now();

    // Atomic SQLite Transaction for cancellation and automatic waitlist promotion
    const cancelTx = db.transaction(() => {
      const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
      if (!booking) {
        throw new AppError(404, 'not_found', 'Booking not found.');
      }

      // Ownership check: members can only cancel their own booking
      if (booking.user_id !== userId && !isAdmin) {
        throw new AppError(403, 'forbidden', 'You can only cancel your own bookings.');
      }

      if (booking.status === 'cancelled') {
        throw new AppError(409, 'already_cancelled', 'Booking is already cancelled.');
      }

      const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(booking.session_id);
      if (session.starts_at <= now) {
        throw new AppError(409, 'session_started', 'You cannot cancel after the session has started.');
      }

      db.prepare(`UPDATE bookings SET status = 'cancelled' WHERE id = ?`).run(bookingId);

      // Automatic waitlist promotion
      // Only promote if session has not started
      let promotedUser = null;
      if (session.starts_at > now) {
        const nextInQueue = db.prepare(`
          SELECT * FROM waitlist
          WHERE session_id = ?
          ORDER BY created_at ASC
          LIMIT 1
        `).get(session.id);

        if (nextInQueue) {
          // Remove from waitlist
          db.prepare('DELETE FROM waitlist WHERE id = ?').run(nextInQueue.id);

          // Generate unique booking code
          let promoCode = generateBookingCode();
          while (db.prepare('SELECT id FROM bookings WHERE code = ?').get(promoCode)) {
            promoCode = generateBookingCode();
          }

          db.prepare(`
            INSERT INTO bookings (session_id, user_id, status, code, checked_in_at, created_at)
            VALUES (?, ?, 'confirmed', ?, NULL, ?)
          `).run(session.id, nextInQueue.user_id, promoCode, now);

          promotedUser = nextInQueue.user_id;
        }
      }

      return { cancelled: true, promotedUser };
    });

    const result = cancelTx();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/sessions/:id/waitlist', authenticateToken, (req, res, next) => {
  try {
    const sessionId = Number(req.params.id);
    const userId = req.user.id;
    const now = Date.now();

    const joinWaitlistTx = db.transaction(() => {
      const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
      if (!session) {
        throw new AppError(404, 'not_found', 'Session not found.');
      }

      if (session.starts_at <= now) {
        throw new AppError(409, 'session_started', 'This session has already started or ended.');
      }

      const confirmedCount = db.prepare(`
        SELECT COUNT(*) AS count FROM bookings
        WHERE session_id = ? AND status = 'confirmed'
      `).get(sessionId).count;

      if (confirmedCount < session.capacity) {
        throw new AppError(409, 'seats_available', 'Mats are free, book one instead.');
      }

      const hasBooking = db.prepare(`
        SELECT id FROM bookings
        WHERE session_id = ? AND user_id = ? AND status = 'confirmed'
      `).get(sessionId, userId);
      if (hasBooking) {
        throw new AppError(409, 'already_booked', 'You already have a confirmed booking for this session.');
      }

      const hasWaitlist = db.prepare(`
        SELECT id FROM waitlist
        WHERE session_id = ? AND user_id = ?
      `).get(sessionId, userId);
      if (hasWaitlist) {
        throw new AppError(409, 'already_waitlisted', 'You are already on the waitlist.');
      }

      db.prepare(`
        INSERT INTO waitlist (session_id, user_id, created_at)
        VALUES (?, ?, ?)
      `).run(sessionId, userId, now);

      return getSessionView(session, userId, now);
    });

    const sessionView = joinWaitlistTx();
    res.json({ session: sessionView });
  } catch (err) {
    next(err);
  }
});

router.delete('/sessions/:id/waitlist', authenticateToken, (req, res, next) => {
  try {
    const sessionId = Number(req.params.id);
    const userId = req.user.id;

    const entry = db.prepare(`
      SELECT id FROM waitlist WHERE session_id = ? AND user_id = ?
    `).get(sessionId, userId);

    if (!entry) {
      throw new AppError(404, 'not_found', 'Waitlist entry not found.');
    }

    db.prepare('DELETE FROM waitlist WHERE id = ?').run(entry.id);
    res.json({ left: true });
  } catch (err) {
    next(err);
  }
});

router.get('/bookings/mine', authenticateToken, (req, res, next) => {
  try {
    const userId = req.user.id;

    const bookings = db.prepare(`
      SELECT b.id, b.code, b.status, b.checked_in_at, s.id AS session_id, s.date, s.hour, s.starts_at
      FROM bookings b
      JOIN sessions s ON s.id = b.session_id
      WHERE b.user_id = ?
      ORDER BY s.starts_at DESC
    `).all(userId);

    const waitlistEntries = db.prepare(`
      SELECT w.session_id, s.date, s.hour, s.starts_at, w.created_at
      FROM waitlist w
      JOIN sessions s ON s.id = w.session_id
      WHERE w.user_id = ?
      ORDER BY s.starts_at ASC
    `).all(userId);

    const waitlist = waitlistEntries.map((w) => {
      const position = db.prepare(`
        SELECT COUNT(*) AS pos FROM waitlist
        WHERE session_id = ? AND created_at <= ?
      `).get(w.session_id, w.created_at).pos;

      return {
        session_id: w.session_id,
        date: w.date,
        hour: w.hour,
        starts_at: w.starts_at,
        position
      };
    });

    res.json({ bookings, waitlist });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// ADMIN ENDPOINTS
// ==========================================

router.get('/admin/sessions/:id/bookings', authenticateToken, requireAdmin, (req, res, next) => {
  try {
    const sessionId = Number(req.params.id);
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);

    if (!session) {
      throw new AppError(404, 'not_found', 'Session not found.');
    }

    const bookings = db.prepare(`
      SELECT b.id, b.status, b.code, b.checked_in_at, u.name, u.email
      FROM bookings b
      JOIN users u ON u.id = b.user_id
      WHERE b.session_id = ?
      ORDER BY b.created_at ASC
    `).all(sessionId);

    res.json({
      session: getSessionView(session, req.user.id),
      bookings
    });
  } catch (err) {
    next(err);
  }
});

router.post('/admin/checkin', authenticateToken, requireAdmin, (req, res, next) => {
  try {
    const { code } = req.body || {};
    const cleanCode = String(code || '').trim().toUpperCase();

    if (!/^[A-Z0-9]{6}$/.test(cleanCode)) {
      throw new AppError(422, 'validation_error', 'Invalid code format. Codes have 6 letters or digits.');
    }

    const booking = db.prepare(`
      SELECT b.*, u.name AS user_name, u.email AS user_email, s.date AS session_date, s.hour AS session_hour, s.starts_at AS session_starts_at
      FROM bookings b
      JOIN users u ON u.id = b.user_id
      JOIN sessions s ON s.id = b.session_id
      WHERE b.code = ?
    `).get(cleanCode);

    if (!booking) {
      throw new AppError(404, 'not_found', 'No booking has that code.');
    }

    if (booking.status === 'cancelled') {
      throw new AppError(409, 'booking_cancelled', 'That booking was cancelled.');
    }

    if (booking.checked_in_at) {
      throw new AppError(409, 'already_checked_in', `${booking.user_name} is already checked in.`);
    }

    const now = Date.now();
    // A code works once, only during its session's hour, and never for a cancelled booking.
    if (now < booking.session_starts_at || now >= booking.session_starts_at + ONE_HOUR_MS) {
      throw new AppError(409, 'outside_session_hour', 'This code only works during its session hour.');
    }

    db.prepare('UPDATE bookings SET checked_in_at = ? WHERE id = ?').run(now, booking.id);

    res.json({
      member: {
        name: booking.user_name,
        email: booking.user_email
      },
      session: {
        id: booking.session_id,
        date: booking.session_date,
        hour: booking.session_hour
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
