var express = require('express');
var Heartbeat = require('../utils/heartbeat');
var logger = require('../utils/logger');

if (process.env.STORAGE) {
  var storageImpl = require(`../storages/${process.env.STORAGE}`);
} else {
  logger.error('Storage not set. Environmental variable STORAGE needs to ' +
    'contain name of storage file inside /storages directory (without extension)');
  process.exit(1);
}
var router = express.Router();

// POST /heartbeat
router.post('/heartbeat', function (req, res) {
  res.set('Content-Type', 'application/json');
  Heartbeat.processRequest(req, res, storageImpl);
});

module.exports = router;
