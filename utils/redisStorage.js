var redis = require('redis');

module.exports = function() {
  var redis_client_opts = {
    url: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
    prefix: process.env.REDIS_NAMESPACE || ''
  }
  var storage = redis.createClient(redis_client_opts);
  setCallbacks(storage);

  return storage;
}

function setCallbacks(storage) {
  storage.on('error', err => { console.log(`Error ${err}`) });
  storage.on('connect', () => { console.log('Redis connected.'); })
}