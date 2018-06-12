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
      console.log(errorMsg);
    });
}

function prepareHeartbeatData(heartbeatData, storage, req, res) {
  return function (userSessionData) {
    var inputData = {
      user_id: heartbeatData.user_id,
      session_id: heartbeatData.session_id,
      new_timestamp: getTimeNowISOString(),
      session_limit: heartbeatData.session_limit,
      checking_threshold: heartbeatData.checking_threshold,
      sessions_edge: heartbeatData.sessions_edge,
      sessions: userSessionData.sessions
    }

    refreshActiveSessions(inputData, storage, heartbeatData);
    logger.verbose('Active sessions', inputData.sessions);

    if (sessionLimitExceeded(inputData)) {
      respondActiveSessionLimitExceeded(res);
      return;
    }

    var outputData = processInputData(inputData, heartbeatData);

    storage.addPostAction('setSession', inputData.user_id,
      inputData.session_id, outputData.sessionConfig);

    if (!!req.body.progress) {
      storage.addPostAction('updateProgress', inputData.user_id,
        heartbeatData.asset_id, req.body.progress);
    }

    res.json(outputData.heartbeatResponse);
  }
}

function processInputData(inputData, heartbeatData) {
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
        heartbeatData, inputData.new_timestamp)) {
      inputData.session_id = uuid();
    }
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
    session_limit: heartbeatData.session_limit,
    checking_threshold: heartbeatData.checking_threshold,
    sessions_edge: heartbeatData.sessions_edge,
    started_at: heartbeatData.started_at,
    timestamp: heartbeatData.timestamp
  }

  return { heartbeat_token: cryptoAES.encrypt(modifiedHeartbeatData, SHARED_KEY) };
}

function needsToCreateNewSession(sessionId, sessions, heartbeatData, newTimestamp) {
  let session = sessions[sessionId];

  let hbDataFromBackend = heartbeatDataFromBackend(heartbeatData);
  let hbSessionMissing = sessionMissing(sessionId, sessions);
  let hbNotExpected = session ?
    heartbeatNotExpected(session.timestamp, heartbeatData.timestamp) : false;
  let hbReceivedTooEarly = session ?
    heartbeatReceivedTooEarly(session.timestamp, newTimestamp,
    heartbeatData.heartbeat_cycle) : false;

  let needsToCreateNewSession = hbDataFromBackend ||
    hbSessionMissing || hbNotExpected || hbReceivedTooEarly;

  if (needsToCreateNewSession) {
    logger.verbose('Needs to create a new session', {
      heartbeat_data_from_backend: hbDataFromBackend,
      session_missing: hbSessionMissing,
      heartbeat_not_expected: hbNotExpected,
      heartbeat_received_too_early: hbReceivedTooEarly
    });
  }

  return needsToCreateNewSession;
}

function needsToSetNewSessionId(sessionId, sessions, heartbeatData, newTimestamp) {
  return needsToCreateNewSession(sessionId, sessions, heartbeatData, newTimestamp) &&
    (!heartbeatDataFromBackend(heartbeatData) ||
        heartbeatDataFromBackend(heartbeatData) &&
          !sessionMissing(sessionId, sessions)
    );
}

function heartbeatDataFromBackend(heartbeatData) {
  return !isDefined(heartbeatData.started_at);
}

var isDefined = (variable) => typeof variable !== 'undefined';

function respondActiveSessionLimitExceeded(res) {
  res.status(412).json({error: 'You have exceeded the maximum allowed number of devices'});
}

function sessionMissing(sessionId, sessions) {
  return sessions[sessionId] == null;
}

function heartbeatNotExpected(timestamp, receivedTimestamp) {
  return (new Date(timestamp)).getTime() != (new Date(receivedTimestamp)).getTime();
}

function heartbeatReceivedTooEarly(timestamp, newTimestamp, heartbeatCycle) {
  return ((new Date(newTimestamp)).getTime() - (new Date(timestamp)).getTime()) < +heartbeatCycle * 1000;
}

function timeExceeded(timestamp, heartbeatCycle, cycleUpperTolerance, timeNow) {
  return new Date(new Date(timestamp).getTime() +
      +heartbeatCycle * 1000 + +cycleUpperTolerance * 1000) < new Date(timeNow);
}

module.exports = {
  processRequest: processRequest
}