var uuid = require('uuid/v4');
var cryptoAES = require('./cryptoAES');

const SHARED_KEY = process.env.SHARED_KEY || 'SHAREDKEY';
const SESSION_LIMIT_OFFSET = process.env.SESSION_LIMIT_OFFSET || 10;

function processRequest(req, res, storage) {
  var heartbeat_data = cryptoAES.decryptToJSON(req.body.heartbeat_token, SHARED_KEY);

  storage.fetchUserSessionData(heartbeat_data.user_id)
    .then(processHeartbeatData(heartbeat_data, storage, req, res))
    .catch((errorMsg) => console.log(errorMsg));
}

function processHeartbeatData(heartbeat_data, storage, req, res) {
  return function (userSessionData) {
    var user_id = heartbeat_data.user_id;
    var session_id = heartbeat_data.session_id;
    var new_timestamp = (new Date()).toISOString();
    var session_limit = userSessionData[0];
    var sessions = userSessionData[1];

    if (heartbeatDataFromBackend(heartbeat_data)) {
      session_limit = heartbeat_data.session_limit;
      storage.setSessionLimit(user_id, heartbeat_data.session_limit);
    }

    sessions = clearAndGetActiveSessions(sessions, storage, heartbeat_data, new_timestamp);

    if (sessionLimitExceeded(sessions, session_id, session_limit)) {
      respondActiveSessionLimitExceeded(res);
      return;
    }

    var session_config = { timestamp: new_timestamp };
    var new_heartbeat_data = Object.assign({}, heartbeat_data);
    new_heartbeat_data.timestamp = new_timestamp;

    if (needsToCreateNewSession(session_id, sessions, heartbeat_data, new_timestamp)) {
      if (!heartbeatDataFromBackend(heartbeat_data)) session_id = uuid();
      session_config.started_at = new_timestamp;
      new_heartbeat_data.started_at = new_timestamp;
    } else {
      session_config.started_at = heartbeat_data.started_at;
    }

    var heartbeat_response = createHeartbeatResponse(session_id, new_heartbeat_data);


    storage.setSession(user_id, session_id, session_config);
    if (!!req.body.progress) storage.updateProgress(user_id, heartbeat_data.asset_id, req.body.progress);

    res.status(200).json(heartbeat_response);
  }
}


function clearAndGetActiveSessions(sessions, storage, heartbeat_data, new_timestamp) {
  if (sessions == null) return {};
  var active_sessions = {}

  for (session_id of Object.keys(sessions)) {
    var session = sessions[session_id];
    if (!timeExceeded(session.timestamp, heartbeat_data.heartbeat_cycle,
        heartbeat_data.cycle_upper_tolerance, new_timestamp)) {
      active_sessions[session_id] = session;
    } else {
      storage.deleteSession(heartbeat_data.user_id, session_id);
    }
  }

  return active_sessions;
}

function sessionLimitExceeded(sessions, session_id, session_limit) {
  var sorted_session_ids = Object.keys(sessions)
    .sort(compareSessionsByStartedAt(sessions));

  return sorted_session_ids.indexOf(session_id) >= session_limit ||
    sorted_session_ids.length > +session_limit + +SESSION_LIMIT_OFFSET;
}

function createHeartbeatResponse(session_id, heartbeat_data) {
  var heartbeat_data = {
    user_id: heartbeat_data.user_id,
    session_id: session_id,
    asset_id: heartbeat_data.asset_id,
    heartbeat_cycle: heartbeat_data.heartbeat_cycle,
    cycle_upper_tolerance: heartbeat_data.cycle_upper_tolerance,
    started_at: heartbeat_data.started_at,
    timestamp: heartbeat_data.timestamp
  }

  return { heartbeat_token: cryptoAES.encrypt(heartbeat_data, SHARED_KEY) };
}

function needsToCreateNewSession(session_id, sessions, heartbeat_data, new_timestamp) {
  let session = sessions[session_id];

  return heartbeatDataFromBackend(heartbeat_data) ||
    sessionMissing(session_id, sessions) ||
    heartbeatNotExpected(session.timestamp, heartbeat_data.timestamp) ||
    heartbeatReceivedTooEarly(session.timestamp, new_timestamp, heartbeat_data.heartbeat_cycle);
}

function heartbeatDataFromBackend(heartbeat_data) {
  return !!heartbeat_data.session_limit;
}

function respondActiveSessionLimitExceeded(res) {
  res.status(412).json({error: 'You have exceeded the maximum allowed number of devices'});
}

function compareSessionsByStartedAt(sessions) {
  return function (session_id_1, session_id_2) {
    var time_1 = (new Date(sessions[session_id_1].started_at)).getTime();
    var time_2 = (new Date(sessions[session_id_2].started_at)).getTime();

    if (time_1 < time_2) return -1;
    if (time_1 > time_2) return 1;
    return 0;
  }
}

function sessionMissing(session_id, sessions) {
  return sessions[session_id] == null;
}

function heartbeatNotExpected(timestamp, received_timestamp) {
  return (new Date(timestamp)).getTime() != (new Date(received_timestamp)).getTime();
}

function heartbeatReceivedTooEarly(timestamp, new_timestamp, heartbeat_cycle) {
  return ((new Date(new_timestamp)).getTime() - (new Date(timestamp)).getTime()) < heartbeat_cycle*1000;
}

function timeExceeded(timestamp, heartbeat_cycle, cycle_upper_tolerance, time_now) {
  return new Date(new Date(timestamp).getTime() +
      heartbeat_cycle*1000 + cycle_upper_tolerance*1000) < new Date(time_now);
}

module.exports = {
  processRequest: processRequest
}