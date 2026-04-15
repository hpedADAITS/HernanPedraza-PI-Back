const { Router } = require('express');
const mongoose = require('mongoose');

const router = Router();

router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'La API de SyncRekuest está ejecutándose',
    timestamp: new Date().toISOString(),
  });
});

// Health check endpoint (DB + API status)
router.get('/health', (req, res) => {
  const dbConnected = mongoose.connection.readyState === 1; // 1 = connected
  res.status(dbConnected ? 200 : 503).json({
    success: dbConnected,
    api: true,
    database: dbConnected,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
