var uuid = require('uuid/v4');
var cryptoAES = require('./cryptoAES');
var logger = require('./logger');

const SHARED_KEY = process.env.SHARED_KEY || 'SHAREDKEY';

function processRequest(req, res, storage) {
  var heartbeat_data = cryptoAES.decryptToJSON(req.body.heartbeat_token, SHARED_KEY);

  storage.fetchUserSessionData(heartbeat_data.user_id)
    .then(prepareHeartbeatData(heartbeat_data, storage, req, res))
    .then(() => storage.executePostActions())
    .catch((errorMsg) => {
      storage.executePostActions();
      console.log(errorMsg) ;
    });
}

function prepareHeartbeatData(heartbeatData, storage, req, res) {
  return function (userSessionData) {
    var inputData = {
      user_id: heartbeatData.user_id,
      session_id: heartbeatData.session_id,
      new_timestamp: getTimeNowISOString(),
      session_limit: userSessionData.session_limit,
      checking_threshold: userSessionData.checking_threshold,
      sessions_edge: userSessionData.sessions_edge,
      sessions: userSessionData.sessions
    }

    if (heartbeatDataFromBackend(heartbeatData))
      updateGlobalSessionConfig(inputData, heartbeatData, storage);

    refreshActiveSessions(inputData, storage, heartbeatData);
    logger.verbose('Active sessions', inputData.sessions);

    if (sessionLimitExceeded(inputData)) {
      respondActiveSessionLimitExceeded(res);
      return;
    }

    var outputData = processOutputData(inputData, heartbeatData);

    storage.addPostAction('setSession', inputData.user_id,
      inputData.session_id, outputData.sessionConfig);

    if (!!req.body.progress) {
      storage.addPostAction('updateProgress', inputData.user_id,
        heartbeatData.asset_id, req.body.progress);
    }

    res.json(outputData.heartbeatResponse);
  }
}

function processOutputData(inputData, heartbeatData) {
  var sessionConfig = {
    timestamp: inputData.new_timestamp,
    hit_counter: getHitCounter(inputData.sessions, inputData.session_id) + 1
  };
  var newHeartbeatData = Object.assign({}, heartbeatData);
  newHeartbeatData.timestamp = inputData.new_timestamp;

  if (needsToCreateNewSession(inputData.session_id, inputData.sessions,
      heartbeatData, inputData.new_timestamp)) {
    logger.verbose('Creating a new session');
    if (needsToSetNewSessionId(inputData.session_id, inputData.sessions,
        heartbeatData, inputData.new_timestamp))
      inputData.session_id = uuid();
    sessionConfig.started_at = inputData.new_timestamp;
    newHeartbeatData.started_at = inputData.new_timestamp;
  } else {
    sessionConfig.started_at = heartbeatData.started_at;
  }

  var heartbeatResponse = createHeartbeatResponse(inputData.session_id, newHeartbeatData);
  logger.verbose('New heartbeat response', heartbeatResponse);

  return {
    sessionConfig: sessionConfig,
    heartbeatResponse: heartbeatResponse
  }
}

function updateGlobalSessionConfig(inputData, heartbeatData, storage) {
  inputData.session_limit = heartbeatData.session_limit;
  inputData.checking_threshold = heartbeatData.checking_threshold;
  inputData.sessions_edge = heartbeatData.sessions_edge;
  storage.addPostAction('setSessionLimit', inputData.user_id, inputData.session_limit);
  storage.addPostAction('setCheckingThreshold', inputData.user_id, inputData.checking_threshold);
  storage.addPostAction('setSessionsEdge', inputData.user_id, inputData.sessions_edge);

  logger.verbose('Received heartbeat data from backend', {
    session_limit: inputData.session_limit,
    checking_threshold: inputData.checking_threshold,
    sessions_edge: inputData.sessions_edge
  });
}

function getTimeNowISOString() {
  return (new Date()).toISOString();
}

function getHitCounter(sessions, session_id) {
  let session = sessions[session_id];
  return session && session.hit_counter ? +session.hit_counter : 0;
}

function refreshActiveSessions(inputData, storage, heartbeat_data) {
  if (inputData.sessions == null) return {};
  var active_sessions = {}

  for (sessionId of Object.keys(inputData.sessions)) {
    var session = inputData.sessions[sessionId];
    if (!timeExceeded(session.timestamp, heartbeat_data.heartbeat_cycle,
        heartbeat_data.cycle_upper_tolerance, inputData.new_timestamp)) {
      active_sessions[sessionId] = session;
    } else {
      storage.addPostAction('deleteSession', heartbeat_data.user_id, sessionId)
    }
  }

  inputData.sessions = active_sessions;
}

function sessionLimitExceeded(inputData) {
  var sessionIds = Object.keys(inputData.sessions)
    .filter(checkingThresholdSatisfied(inputData.sessions, inputData.checking_threshold))
    .sort(compareSessionsByStartedAt(inputData.sessions));

  let sessionsEdgeExceeded = Object.keys(inputData.sessions).length > +inputData.sessions_edge;
  let sessionOverLimit = sessionIds.indexOf(inputData.session_id) >= +inputData.session_limit;

  let sessionLimitExceeded = sessionsEdgeExceeded || sessionOverLimit
  if (sessionLimitExceeded) {
    logger.verbose('Session limit exceeded', {
      sessionsEdgeExceeded: sessionLimitExceeded,
      sessionOverLimit: sessionOverLimit
    });
  }

  return sessionLimitExceeded;
}

function checkingThresholdSatisfied(sessions, checkingThreshold) {
  return function (sessionId) {
    let session = sessions[sessionId];
    return !!session && +session.hit_counter >= +checkingThreshold;
  };
}

function compareSessionsByStartedAt(sessions) {
  return function (sessionId1, sessionId2) {
    var time1 = (new Date(sessions[sessionId1].started_at)).getTime();
    var time2 = (new Date(sessions[sessionId2].started_at)).getTime();

    if (time1 < time2) return -1;
    if (time1 > time2) return 1;
    return 0;
  }
}

function createHeartbeatResponse(sessionId, heartbeatData) {
  var modifiedHeartbeatData = {
    user_id: heartbeatData.user_id,
    session_id: sessionId,
    asset_id: heartbeatData.asset_id,
    heartbeat_cycle: heartbeatData.heartbeat_cycle,
    cycle_upper_tolerance: heartbeatData.cycle_upper_tolerance,
    started_at: heartbeatData.started_at,
    timestamp: heartbeatData.timestamp
  }

  return { heartbeat_token: cryptoAES.encrypt(modifiedHeartbeatData, SHARED_KEY) };
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

function needsToSetNewSessionId(session_id, sessions, heartbeat_data, new_timestamp) {
  return needsToCreateNewSession(session_id, sessions, heartbeat_data, new_timestamp) &&
    !heartbeatDataFromBackend(heartbeat_data);
}

function heartbeatDataFromBackend(heartbeat_data) {
  return isDefined(heartbeat_data.session_limit) &&
    isDefined(heartbeat_data.checking_threshold) &&
    isDefined(heartbeat_data.sessions_edge);
}

var isDefined = (variable) => typeof variable !== 'undefined';

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