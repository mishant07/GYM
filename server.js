const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const routes = require('./src/routes');
const { errorHandler } = require('./src/middleware');
const { seedDatabase } = require('./src/seed');

const app = express();
const PORT = process.env.PORT || 3000;

// Security and parsing middlewares
app.use(cors());
app.use(express.json());

// Auto-seed database with initial users and sessions if empty
try {
  seedDatabase(false);
} catch (e) {
  console.error('Database initialization warning:', e.message);
}

// Serve static frontend files from current directory
app.use(express.static(path.join(__dirname)));

// Mount API routes at both /api and root level for maximum client flexibility
app.use('/api', routes);
app.use(routes);

// Centralized error handler (guarantees API never crashes or leaks stack traces)
app.use(errorHandler);

// Start server if executed directly
if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`Twenty Gym Booking server running on http://localhost:${PORT}`);
  });

  const shutdown = () => {
    console.log('Shutting down server gracefully...');
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = app;
