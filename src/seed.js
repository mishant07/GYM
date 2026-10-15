const bcrypt = require('bcryptjs');
const db = require('./db');
const { generateBookingCode, pad, formatDate } = require('./utils');

function seedDatabase(force = false) {
  const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (userCount > 0 && !force) {
    console.log('Database already seeded. Skipping.');
    return;
  }

  console.log('Seeding database with initial data...');

  const now = new Date();
  const currentHour = now.getHours();
  const todayStr = formatDate(now.getTime());

  // Clear existing if force
  if (force) {
    db.exec(`
      DELETE FROM waitlist;
      DELETE FROM bookings;
      DELETE FROM sessions;
      DELETE FROM users;
    `);
  }

  const saltRounds = 10;
  const adminHash = bcrypt.hashSync('AdminPass123', saltRounds);
  const memberHash = bcrypt.hashSync('MemberPass123', saltRounds);

  const insertUser = db.prepare(`
    INSERT INTO users (name, email, password_hash, role, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const adminUser = insertUser.run('Gym Admin', 'admin@gym.test', adminHash, 'admin', Date.now());
  const aliceUser = insertUser.run('Alice Member', 'alice@gym.test', memberHash, 'member', Date.now());
  const bobUser = insertUser.run('Bob Member', 'bob@gym.test', memberHash, 'member', Date.now());

  const firstNames = ['Priya', 'Rahul', 'Meera', 'Arjun', 'Sana', 'Kabir', 'Isha', 'Dev', 'Nisha', 'Vikram', 'Anaya', 'Rohan', 'Tara', 'Karan', 'Zoya', 'Aditya', 'Diya', 'Imran', 'Lata', 'Neel'];
  const lastNames = ['Shah', 'Rao', 'Iyer', 'Das', 'Khan'];
  const mockUsers = [];

  for (let i = 0; i < firstNames.length; i++) {
    const name = `${firstNames[i]} ${lastNames[i % lastNames.length]}`;
    const email = `${firstNames[i].toLowerCase()}.${lastNames[i % lastNames.length].toLowerCase()}@gym.test`;
    const res = insertUser.run(name, email, memberHash, 'member', Date.now());
    mockUsers.push({ id: res.lastInsertRowid, name, email });
  }

  const insertSession = db.prepare(`
    INSERT INTO sessions (date, hour, starts_at, capacity, created_at)
    VALUES (?, ?, ?, 20, ?)
  `);

  const insertBooking = db.prepare(`
    INSERT INTO bookings (session_id, user_id, status, code, checked_in_at, created_at)
    VALUES (?, ?, 'confirmed', ?, ?, ?)
  `);

  const insertWaitlist = db.prepare(`
    INSERT INTO waitlist (session_id, user_id, created_at)
    VALUES (?, ?, ?)
  `);

  // 1. Live Session (Current Hour today, started)
  const liveDate = new Date();
  liveDate.setMinutes(0, 0, 0);
  const liveStartsAt = liveDate.getTime();
  const liveSessionRes = insertSession.run(todayStr, currentHour, liveStartsAt, Date.now());
  const liveSessionId = liveSessionRes.lastInsertRowid;

  // Alice is booked in the live session with a valid code ready for check-in testing
  insertBooking.run(liveSessionId, aliceUser.lastInsertRowid, generateBookingCode(), null, Date.now() - 3600000);
  // Add 7 other attendees
  for (let i = 0; i < 7; i++) {
    insertBooking.run(liveSessionId, mockUsers[i].id, generateBookingCode(), i < 3 ? Date.now() - 600000 : null, Date.now() - 3600000);
  }

  // 2. Upcoming Session Today (2 hours later)
  if (currentHour + 2 <= 23) {
    const sDate = new Date();
    sDate.setHours(currentHour + 2, 0, 0, 0);
    const sId = insertSession.run(todayStr, currentHour + 2, sDate.getTime(), Date.now()).lastInsertRowid;
    for (let i = 0; i < 5; i++) {
      insertBooking.run(sId, mockUsers[i].id, generateBookingCode(), null, Date.now());
    }
  }

  // 3. Tomorrow's sessions:
  // Tomorrow at 07:00 (Few spots taken)
  const d1 = new Date();
  d1.setDate(d1.getDate() + 1);
  const d1Str = formatDate(d1.getTime());

  d1.setHours(7, 0, 0, 0);
  const t7Id = insertSession.run(d1Str, 7, d1.getTime(), Date.now()).lastInsertRowid;
  for (let i = 0; i < 4; i++) {
    insertBooking.run(t7Id, mockUsers[i].id, generateBookingCode(), null, Date.now());
  }

  // Tomorrow at 10:00 (Almost full - 18 spots taken)
  d1.setHours(10, 0, 0, 0);
  const t10Id = insertSession.run(d1Str, 10, d1.getTime(), Date.now()).lastInsertRowid;
  for (let i = 0; i < 18; i++) {
    insertBooking.run(t10Id, mockUsers[i].id, generateBookingCode(), null, Date.now());
  }

  // Tomorrow at 18:00 - COMPLETELY FULL (20/20 spots) + Bob on waitlist!
  d1.setHours(18, 0, 0, 0);
  const fullSessionId = insertSession.run(d1Str, 18, d1.getTime(), Date.now()).lastInsertRowid;
  for (let i = 0; i < 20; i++) {
    insertBooking.run(fullSessionId, mockUsers[i].id, generateBookingCode(), null, Date.now());
  }
  // Bob joins waitlist
  insertWaitlist.run(fullSessionId, bobUser.lastInsertRowid, Date.now());

  // 4. Future sessions over next 4 days
  for (let dayOffset = 2; dayOffset <= 5; dayOffset++) {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + dayOffset);
    const futureDateStr = formatDate(futureDate.getTime());

    [8, 12, 17].forEach((h) => {
      futureDate.setHours(h, 0, 0, 0);
      const fsId = insertSession.run(futureDateStr, h, futureDate.getTime(), Date.now()).lastInsertRowid;
      // Some light bookings
      for (let i = 0; i < (h % 5); i++) {
        insertBooking.run(fsId, mockUsers[i].id, generateBookingCode(), null, Date.now());
      }
    });
  }

  console.log('Seeding complete! Admin and members ready with test sessions.');
}

if (require.main === module) {
  seedDatabase(process.argv.includes('--force'));
}

module.exports = { seedDatabase };
