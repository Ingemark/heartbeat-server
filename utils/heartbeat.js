var uuid = require('uuid/v4');
var cryptoAES = require('./cryptoAES');
var logger = require('./logger');

const SHARED_KEY = process.env.SHARED_KEY || 'SHAREDKEY';

function processRequest(req, res, storage) {
  var heartbeat_data = cryptoAES.decryptToJSON(req.body.heartbeat_token, SHARED_KEY);

  storage.fetchUserSessionData(heartbeat_data.user_id)
    .then(processHeartbeatData(heartbeat_data, storage, req, res))
    .catch((errorMsg) => console.log(errorMsg));
}

function processHeartbeatData(heartbeat_data, storage, req, res) {
  return function (user_session_data) {
    var user_id = heartbeat_data.user_id;
    var session_id = heartbeat_data.session_id;
    var new_timestamp = getTimeNowISOString();
    var session_limit = user_session_data.session_limit;
    var checking_threshold = user_session_data.checking_threshold;
    var sessions_edge = user_session_data.sessions_edge;
    var sessions = user_session_data.sessions;

    logger.verbose('User session data', {
      user_session_data: user_session_data,
      new_timestamp: new_timestamp
    });

    if (heartbeatDataFromBackend(heartbeat_data)) {
      session_limit = heartbeat_data.session_limit;
      checking_threshold = heartbeat_data.checking_threshold;
      sessions_edge = heartbeat_data.sessions_edge;
      storage.setSessionLimit(user_id, heartbeat_data.session_limit);
      storage.setCheckingThreshold(user_id, heartbeat_data.checking_threshold);
      storage.setSessionsEdge(user_id, heartbeat_data.sessions_edge);

      logger.verbose('Received heartbeat data from backend', {
        session_limit: session_limit,
        checking_threshold: checking_threshold,
        sessions_edge: sessions_edge
      });
    }

    sessions = clearAndGetActiveSessions(sessions, storage, heartbeat_data, new_timestamp);
    logger.verbose('Active sessions', sessions);

    if (sessionLimitExceeded(sessions, session_id,
        session_limit, checking_threshold, sessions_edge)) {
      respondActiveSessionLimitExceeded(res);
      return;
    }

    var session_config = {
      timestamp: new_timestamp,
      hit_counter: getHitCounter(sessions, session_id) + 1
    };
    var new_heartbeat_data = Object.assign({}, heartbeat_data);
    new_heartbeat_data.timestamp = new_timestamp;

    if (needsToCreateNewSession(session_id, sessions, heartbeat_data, new_timestamp)) {
      logger.verbose('Creating a new session');
      if (!heartbeatDataFromBackend(heartbeat_data)) session_id = uuid();
      session_config.started_at = new_timestamp;
      new_heartbeat_data.started_at = new_timestamp;
    } else {
      session_config.started_at = heartbeat_data.started_at;
    }

    var heartbeat_response = createHeartbeatResponse(session_id, new_heartbeat_data);
    logger.verbose('New heartbeat response', heartbeat_response);

    storage.setSession(user_id, session_id, session_config);
    logger.verbose('Set session', {
      user_id: user_id,
      session_id: session_id,
      session_config: session_config
    })

    if (!!req.body.progress) {
      storage.updateProgress(user_id, heartbeat_data.asset_id, req.body.progress);
      logger.verbose('Updated progress', {
        user_id: user_id,
        asset_id: heartbeat_data.asset_id,
        progress: req.body.progress
      })
    }

    res.status(200).json(heartbeat_response);
  }
}

function getTimeNowISOString() {
  return (new Date()).toISOString();
}


function getHitCounter(sessions, session_id) {
  let session = sessions[session_id];
  return session && session.hit_counter ? +session.hit_counter : 0;
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
      logger.verbose('Deleted session', {user_id: heartbeat_data.user_id, session_id: session_id});
    }
  }

  return active_sessions;
}

function sessionLimitExceeded(sessions, session_id, session_limit,
                              checking_threshold, sessions_edge) {
  var session_ids = Object.keys(sessions)
    .filter(checkingThresholdSatisfied(sessions, checking_threshold))
    .sort(compareSessionsByStartedAt(sessions));

  let sessionsEdgeExceeded = Object.keys(sessions).length > +sessions_edge;
  let sessionOverLimit = session_ids.indexOf(session_id) >= session_limit;

  let sessionLimitExceeded = sessionsEdgeExceeded || sessionOverLimit
  if (sessionLimitExceeded) {
    logger.verbose('Session limit exceeded', {
      sessionsEdgeExceeded: sessionLimitExceeded,
      sessionOverLimit: sessionOverLimit
    });
  }

  return sessionsEdgeExceeded || sessionOverLimit;
}

function checkingThresholdSatisfied(sessions, checking_threshold) {
  return function (session_id) {
    let session = sessions[session_id];
    return !!session && +session.hit_counter >= +checking_threshold;
  };
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

  return {heartbeat_token: cryptoAES.encrypt(heartbeat_data, SHARED_KEY)};
}

function needsToCreateNewSession(session_id, sessions, heartbeat_data, new_timestamp) {
  let session = sessions[session_id];

  let heartbeat_data_from_backend = heartbeatDataFromBackend(heartbeat_data);
  let session_missing = sessionMissing(session_id, sessions);
  let heartbeat_not_expected = session ?
    heartbeatNotExpected(session.timestamp, heartbeat_data.timestamp) : false;
  let heartbeat_received_too_early = session ?
    heartbeatReceivedTooEarly(session.timestamp, new_timestamp,
    heartbeat_data.heartbeat_cycle) : false;

  let needs_to_create_new_session = heartbeat_data_from_backend ||
    session_missing || heartbeat_not_expected || heartbeat_received_too_early;

  if (needs_to_create_new_session) {
    logger.verbose('Needs to create a new session', {
      heartbeat_data_from_backend: heartbeat_data_from_backend,
      session_missing: session_missing,
      heartbeat_not_expected: heartbeat_not_expected,
      heartbeat_received_too_early: heartbeat_received_too_early
    });
  }

  return needs_to_create_new_session;
}

function heartbeatDataFromBackend(heartbeat_data) {
  return heartbeat_data.session_limit && heartbeat_data.checking_threshold;
}

function respondActiveSessionLimitExceeded(res) {
  res.status(412).json({error: 'You have exceeded the maximum allowed number of devices'});
}

function sessionMissing(session_id, sessions) {
  return sessions[session_id] == null;
}

function heartbeatNotExpected(timestamp, received_timestamp) {
  return (new Date(timestamp)).getTime() != (new Date(received_timestamp)).getTime();
}

function heartbeatReceivedTooEarly(timestamp, new_timestamp, heartbeat_cycle) {
  return ((new Date(new_timestamp)).getTime() - (new Date(timestamp)).getTime()) < +heartbeat_cycle * 1000;
}

function timeExceeded(timestamp, heartbeat_cycle, cycle_upper_tolerance, time_now) {
  return new Date(new Date(timestamp).getTime() +
      +heartbeat_cycle * 1000 + +cycle_upper_tolerance * 1000) < new Date(time_now);
}

module.exports = {
  processRequest: processRequest
}