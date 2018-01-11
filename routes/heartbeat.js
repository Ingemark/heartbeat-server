var express = require('express');
var CryptoJS = require("crypto-js");
var uuid = require('uuid/v4');
var redis = require('redis');

var router = express.Router();

const SHARED_KEY = process.env.SHARED_KEY || 'SHAREDKEY';
const SESSION_LIMIT_OFFSET = process.env.SESSION_LIMIT_OFFSET || 10;

var redis_client_opts = {
  url: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  prefix: process.env.REDIS_NAMESPACE || ''
}
var storage = redis.createClient(redis_client_opts);
storage.on("error", err => { console.log("Error " + err) });

// POST /heartbeat
router.post('/heartbeat', function (req, res, next) {
  res.set('Content-Type', 'application/json');

  var heartbeat_data = decryptAEStoJSON(req.body.heartbeat_token);

  var multi_get = storage.multi();
  multi_get.get(`hb_sessions:${heartbeat_data.user_id}:session_limit`);
  multi_get.hgetall(`hb_sessions:${heartbeat_data.user_id}:active_sessions`);
  multi_get.exec(processHeartbeatData(heartbeat_data, res, req));
});

// Helper functions

function processHeartbeatData(heartbeat_data, res, req) {
  return function (err, replies) {
    var user_id = heartbeat_data.user_id;
    var session_id = heartbeat_data.session_id;
    var new_timestamp = (new Date()).toISOString();
    var session_limit = replies[0];
    var sessions = replies[1];

    sessions = clearAndGetActiveSessions(sessions, heartbeat_data, new_timestamp);

    if (sessionLimitExceeded(sessions, session_id, session_limit)) {
      respondActiveSessionLimitExceeded(res);
      return;
    }

    var session_config = {
      timestamp: new_timestamp
    }
    if (needsToCreateNewSession(session_id, sessions, heartbeat_data, new_timestamp)) {
      if (!heartbeatDataFromBackend(heartbeat_data)) session_id = uuid();
      session_config.started_at = new_timestamp;
      heartbeat_data.started_at = new_timestamp;
      var heartbeat_response = createHeartbeatResponse(heartbeat_data, session_id, new_timestamp, 'Session created');
    } else {
      session_config.started_at = heartbeat_data.started_at;
      var heartbeat_response = createHeartbeatResponse(heartbeat_data, session_id, new_timestamp, 'Session updated');
    }

    storage.hset(`hb_sessions:${user_id}:active_sessions`, session_id, JSON.stringify(session_config));
    if (!!req.body.progress)
      storage.set(`user_progress:${user_id}:${session_config.asset_id}`, req.body.progress);
    if (heartbeatDataFromBackend(heartbeat_data))
      storage.set(`hb_sessions:${user_id}:session_limit`, heartbeat_data.session_limit);

    res.status(200).json(heartbeat_response);
  }
}


function clearAndGetActiveSessions(sessions, heartbeat_data, new_timestamp) {
  if (sessions == null) return {};
  var active_sessions = {}

  for (session_id of Object.keys(sessions)) {
    var session = JSON.parse(sessions[session_id]);
    if (!timeExceeded(session.timestamp,
        heartbeat_data.repeat_period, heartbeat_data.time_offset, new_timestamp)) {
      active_sessions[session_id] = session;
      console.log('active', session, session.timestamp,
        heartbeat_data.repeat_period, heartbeat_data.time_offset, new_timestamp);
    } else {
      storage.hdel(`hb_sessions:${heartbeat_data.user_id}:active_sessions`, session_id);
    }
  }

  return active_sessions;
}

function sessionLimitExceeded(sessions, session_id, session_limit) {
  var sorted_session_ids = Object.keys(sessions)
    .sort(compareSessionsByCreatedAt(sessions));


  return sorted_session_ids.indexOf(session_id) >= session_limit ||
    sorted_session_ids.length > +session_limit + +SESSION_LIMIT_OFFSET;
}

function createHeartbeatResponse(heartbeat_data, session_id, timestamp, dbg_msg) {
  var heartbeat_data = {
    user_id: heartbeat_data.user_id,
    asset_id: heartbeat_data.asset_id,
    session_id: session_id,
    repeat_period: heartbeat_data.repeat_period,
    time_offset: heartbeat_data.time_offset,
    started_at: heartbeat_data.started_at,
    timestamp: timestamp
  }

  let heartbeat_response = { heartbeat_token: encryptAES(heartbeat_data) }
  if (dbg_msg !== null) heartbeat_response.dbg_msg = dbg_msg;

  return heartbeat_response
}

function needsToCreateNewSession(session_id, sessions, heartbeat_data, new_timestamp) {
  let session = sessions[session_id];
  return heartbeatDataFromBackend(heartbeat_data) ||
    sessionMissing(session_id, sessions) ||
    timeExceeded(session.timestamp, heartbeat_data.repeat_period,
      heartbeat_data.time_offset, new_timestamp) ||
    heartbeatNotExpected(session.timestamp, heartbeat_data.timestamp);
}

function heartbeatDataFromBackend(heartbeat_data) {
  return !!heartbeat_data.session_limit;
}

function respondActiveSessionLimitExceeded(res) {
  res.status(412).json({error: 'You have exceeded the maximum allowed number of devices'});
}

function decryptAEStoJSON(cipher) {
  var data = CryptoJS.AES.decrypt(cipher, SHARED_KEY);
  return JSON.parse(data.toString(CryptoJS.enc.Utf8));
}

function compareSessionsByCreatedAt(sessions) {
  return function (session_id_1, session_id_2) {
    var time_1 = (new Date(sessions[session_id_1].started_at)).getTime();
    var time_2 = (new Date(sessions[session_id_2].started_at)).getTime();

    if (time_1 < time_2) return -1;
    if (time_1 > time_2) return 1;
    return 0;
  }
}

function encryptAES(data) {
  return CryptoJS.AES.encrypt(JSON.stringify(data), SHARED_KEY).toString();
}

function sessionMissing(session_id, sessions) {
  return sessions[session_id] == null;
}

function heartbeatNotExpected(timestamp, received_timestamp) {
  return (new Date(timestamp)).getTime() != (new Date(received_timestamp)).getTime();
}

function timeExceeded(timestamp, repeat_period, offset, time_now) {
  return new Date(new Date(timestamp).getTime() +
      repeat_period * 1000 + offset * 1000) < new Date(time_now);
}

module.exports = router;
    