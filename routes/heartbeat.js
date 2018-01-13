var express = require('express');
var Heartbeat = require('../utils/heartbeat');
var redisStorage = require('../utils/redisStorage');

var router = express.Router();
var storage = redisStorage();

// POST /heartbeat
router.post('/heartbeat', function (req, res) {
  res.set('Content-Type', 'application/json');

  Heartbeat.processRequest(req, res, storage);
});

module.exports = router;
    