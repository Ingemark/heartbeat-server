var express = require('express');
var CryptoJS = require("crypto-js");
const http = require('simple-get')
var uuid = require('uuid/v4');

var router = express.Router();

const SHARED_KEY = 'SHAREDKEY';

// http.concat('http://localhost:3300/assets/34', 
// function (err, res, data) {
//   if (err) throw err
//   var parsed_data = JSON.parse(data.toString('utf8'));
//   var decrypted_heartbeat = CryptoJS.AES.decrypt(parsed_data.heartbeat_token, SHARED_KEY);
//   console.log(`decrypted heartbeat content = ${
//     JSON.stringify(JSON.parse(decrypted_heartbeat.toString(CryptoJS.enc.Utf8)), null, 2)
//   }`); 
// })

var session_storage = {};

router.post('/heartbeat', function(req, res, next) {
  res.set('Content-Type', 'application/json');
  
  var heartbeat_data = decryptAEStoJSON(req.body.heartbeat_token);

  var user_id = heartbeat_data.user_id
  var session_id = heartbeat_data.session_id
  var new_timestamp = (new Date()).toISOString();

  if (isFullHeartbeatData(heartbeat_data)) {
    if (session_storage[user_id] == undefined) session_storage[user_id] = {};
    if (session_storage[user_id].sessions == undefined) session_storage[user_id].sessions = {};
    if (session_storage[user_id].sessions[session_id]) {
      if (activeSessionLimitExceeded(user_id, new_timestamp)) {
        respondActiveSessionLimitExceeded(res);
        return;
      } else session_id = uuid();
    }
    session_storage[user_id].max_allowed_sessions = heartbeat_data.max_allowed_sessions;

    var session_config = {
      asset_id: heartbeat_data.asset_id,
      repeat_period: heartbeat_data.repeat_period,
      time_offset: heartbeat_data.time_offset,
      timestamp: new_timestamp,
      progress: req.body.progress
    }

    storeSession(user_id, session_id, session_config);
    heartbeat_response = createHeartbeatResponse(user_id, session_id, new_timestamp)

    res.json(heartbeat_response);
    return;

  } else { // Basic heartbeat data

    if(sessionMissing(user_id, session_id)) {
      respondSessionMissing(res);
      return;
    }

    if (activeSessionLimitExceeded(user_id, new_timestamp)) {
      respondActiveSessionLimitExceeded(res);
      return;
    }

    session = getSession(user_id, session_id);

    var needsToCreateNewSession = timeExceeded(session.timestamp, session.repeat_period, 
          session.time_offset, new_timestamp) || 
          heartbeatNotExpected(session.timestamp, heartbeat_data.timestamp)
    if (needsToCreateNewSession) {

      var session_config = {
        asset_id: session.asset_id,
        repeat_period: session.repeat_period,
        time_offset: session.time_offset,
        timestamp: new_timestamp,
        progress: req.body.progress
      }
  
      var new_session_id = uuid();
      storeSession(user_id, new_session_id, session_config);
      heartbeat_response = createHeartbeatResponse(user_id, new_session_id, new_timestamp)
      
      res.json(heartbeat_response);
      return; 
    }

    session.progress = req.body.progress;
    session.timestamp = new_timestamp;
    session_storage[user_id].sessions[session_id] = session;
    
    heartbeat_data.timestamp = new_timestamp;

    var heartbeat_response = {
      heartbeat_token: encryptAES(heartbeat_data),
      debug_message: 'OK'
    }

    res.status(200).json(heartbeat_response);
  }

});

// Helper functions

function storeSession(user_id, session_id, session_config) {
  session_storage[user_id].sessions[session_id] = session_config;
}

function createHeartbeatResponse(user_id, session_id, timestamp) {
  var heartbeat_data = {
    user_id: user_id, 
    session_id: session_id,
    timestamp: timestamp
  }
  
  return { 
    heartbeat_token: encryptAES(heartbeat_data),
    debug_message: 'Created a new session!'
  }
}

function respondSessionMissing(res) {
  res.status(200).json({ dbg_msg: 'Storage data missing, backend issue, keep playing!'});
}

function respondActiveSessionLimitExceeded(res) {
  res.status(412).json({ error: 'You have exceeded the maximum allowed number of devices' });
}

function decryptAEStoJSON(cipher) {
  var data = CryptoJS.AES.decrypt(cipher, SHARED_KEY);
  return JSON.parse(data.toString(CryptoJS.enc.Utf8));
}

function activeSessionLimitExceeded(user_id, new_timestamp) {
  var max_allowed_sessions = session_storage[user_id].max_allowed_sessions
  var active_sessions = Object.keys(session_storage[user_id].sessions)
    .filter(function(session_id) {
      var session = session_storage[user_id].sessions[session_id];
      return !timeExceeded(session.timestamp, session.repeat_period,
         session.time_offset, new_timestamp);
    }
  ).length

  console.log('Active sessions:', active_sessions);

  return active_sessions > max_allowed_sessions;
}

function encryptAES(data) {
  return CryptoJS.AES.encrypt(JSON.stringify(data), SHARED_KEY).toString();
}

function isFullHeartbeatData(heartbeat_data) {
  return heartbeat_data.user_id && heartbeat_data.session_id && heartbeat_data.asset_id;
}

function sessionMissing(user_id, session_id) {
  return session_storage[user_id] == undefined ||
    session_storage[user_id].sessions[session_id] == undefined;
}

function getSession(user_id, session_id) {
  return session_storage[user_id].sessions[session_id];
}

function heartbeatNotExpected(timestamp, received_timestamp) {
  return (new Date(timestamp)).getTime() != (new Date(received_timestamp)).getTime();
}

function timeExceeded(timestamp, repeat_period, offset, time_now) {
  return new Date(new Date(timestamp).getTime() + 
    repeat_period*1000 + offset*1000) < new Date(time_now);
}

module.exports = router;
