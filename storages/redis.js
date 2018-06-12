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
    client.hgetall(`hb_sessions:${user_id}:active_sessions`, function (err, response) {
      if (err) {
        let error_msg = 'Error while fetching user session data from Redis'
        logger.error(error_msg, err);
        reject({info: error_msg, error: err});
      }

      let sessions = response;

      if (!!sessions) {
        Object.keys(sessions).map((key, _) => {
          sessions[key] = JSON.parse(sessions[key]);
        });
      } else {
        sessions = {}
      }

      resolve({ sessions: sessions });
    });
  });
}

function setSession(user_id, session_id, session_config) {
  client.hset(`hb_sessions:${user_id}:active_sessions`, session_id, JSON.stringify(session_config));
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
  updateProgress: updateProgress,
  deleteSession: deleteSession,
  executePostActions: executePostActions,
  addPostAction: addPostAction
};
