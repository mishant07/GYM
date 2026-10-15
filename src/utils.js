const crypto = require('crypto');

// 32 unambiguous characters (excludes 0, O, 1, I to eliminate user confusion at check-in)
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Generates an unguessable 6-character alphanumeric code using CSPRNG.
 * 32^6 = 1,073,741,824 combinations.
 */
function generateBookingCode() {
  const bytes = crypto.randomBytes(6);
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function formatDate(timestamp) {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function getSessionTimestamp(dateStr, hour) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day, hour, 0, 0, 0);
  return d.getTime();
}

module.exports = {
  generateBookingCode,
  pad,
  formatDate,
  getSessionTimestamp
};
