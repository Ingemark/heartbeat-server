var redis = require('redis');

module.exports = function() {
  var redis_client_opts = {
    url: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
    prefix: process.env.REDIS_NAMESPACE || ''
  }
  var client = redis.createClient(redis_client_opts);

  setCallbacks();

  // Private functions

  function setCallbacks() {
    client.on('error', err => { console.log(`Error ${err}`) });
    client.on('connect', () => { console.log('Redis connected.'); })
  }

  // Exported functions

  function fetchUserSessionData(user_id) {
    return new Promise((resolve, reject) => {
      var multi_get = client.multi();
      multi_get.get(`hb_sessions:${user_id}:session_limit`);
      multi_get.hgetall(`hb_sessions:${user_id}:active_sessions`);

      multi_get.exec(function (err, replies) {
        if (err) reject(`Error while fetching user session data from Redis:\n${err}`);

        let session_limit = replies[0];
        let sessions = replies[1];

        Object.keys(sessions).map((key, _) => {
          sessions[key] = JSON.parse(sessions[key]);
        });
        resolve([session_limit, sessions]);
      });
    });
  }

  function setSession(user_id, session_id, session_config) {
    client.hset(`hb_sessions:${user_id}:active_sessions`, session_id, JSON.stringify(session_config));
  }

  function setSessionLimit(user_id, session_limit) {
    client.set(`hb_sessions:${user_id}:session_limit`, session_limit);
  }

  function updateProgress(user_id, asset_id, progress) {
    client.hset('user_progress', `${user_id}:${asset_id}`, progress);
  }

  function deleteSession(user_id, session_id) {
    client.hdel(`hb_sessions:${user_id}:active_sessions`, session_id);
  }

  return {
    fetchUserSessionData: fetchUserSessionData,
    setSession: setSession,
    setSessionLimit: setSessionLimit,
    updateProgress: updateProgress,
    deleteSession: deleteSession
  };
}

