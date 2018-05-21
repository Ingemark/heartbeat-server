var redis = require('redis');
var logger = require('../utils/logger');

var redis_client_opts = {
  url: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  prefix: process.env.REDIS_NAMESPACE || ''
}
var client = redis.createClient(redis_client_opts);
var postActionsBuffer = [];
var self = this;

setCallbacks();

// Private functions

function setCallbacks() {
  client.on('error', err => {
    logger.error('Redis error', err);
  });
  client.on('connect', () => {
    logger.info('Redis connected!', redis_client_opts);
  })
}

// Exported functions

function fetchUserSessionData(user_id) {
  return new Promise((resolve, reject) => {
    var multi_get = client.multi();
    multi_get.get(`hb_sessions:${user_id}:session_limit`);
    multi_get.get(`hb_sessions:${user_id}:checking_threshold`);
    multi_get.get(`hb_sessions:${user_id}:sessions_edge`);
    multi_get.hgetall(`hb_sessions:${user_id}:active_sessions`);

    multi_get.exec(function (err, replies) {
      if (err) {
        let error_msg = 'Error while fetching user session data from Redis'
        logger.error(error_msg, err);
        reject({info: error_msg, error: err});
      }

      let session_limit = replies[0];
      let checking_threshold = replies[1];
      let sessions_edge = replies[2];
      let sessions = replies[3];

      if (!!sessions) {
        Object.keys(sessions).map((key, _) => {
          sessions[key] = JSON.parse(sessions[key]);
        });
      } else {
        sessions = {}
      }

      let userSessionData = {
        session_limit: session_limit,
        checking_threshold: checking_threshold,
        sessions_edge: sessions_edge,
        sessions: sessions
      }

      resolve(userSessionData);
    });
  });
}

function setSession(user_id, session_id, session_config) {
  client.hset(`hb_sessions:${user_id}:active_sessions`, session_id, JSON.stringify(session_config));
}

function setSessionLimit(user_id, session_limit) {
  client.set(`hb_sessions:${user_id}:session_limit`, session_limit);
}

function setSessionsEdge(user_id, sessions_edge) {
  client.set(`hb_sessions:${user_id}:sessions_edge`, sessions_edge);
}

function setCheckingThreshold(user_id, checking_threshold) {
  client.set(`hb_sessions:${user_id}:checking_threshold`, checking_threshold);
}

function updateProgress(user_id, asset_id, progress) {
  client.hset('user_progress', `${user_id}:${asset_id}`, progress);
}

function deleteSession(user_id, session_id) {
  client.hdel(`hb_sessions:${user_id}:active_sessions`, session_id);
}

function addPostAction(methodName, ...methodParams) {
  methodParams.unshift(methodName);
  postActionsBuffer.push(methodParams);
}

function executePostActions() {
  for (var i in postActionsBuffer) {
    var method = postActionsBuffer[i][0]
    var params = postActionsBuffer[i].slice(1)

    this[method].apply(this, params)
  }

  postActionsBuffer = []
}

module.exports = {
  fetchUserSessionData: fetchUserSessionData,
  setSession: setSession,
  setSessionLimit: setSessionLimit,
  setCheckingThreshold: setCheckingThreshold,
  setSessionsEdge: setSessionsEdge,
  updateProgress: updateProgress,
  deleteSession: deleteSession,
  executePostActions: executePostActions,
  addPostAction: addPostAction
};
