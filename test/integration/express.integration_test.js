// This integration/system test should be ran in docker container

var cryptoAES = require('../utils/cryptoAES')
  , chai = require('chai')
  , assert = chai.assert
  , faker = require('faker');

chai.use(require('chai-http'));

const SHARED_KEY = 'master_password';

describe('POST /heartbeat', function () {
  var envName, pathToCompose;

  it('returns 200 OK', async function () {
    let heartbeatServerAddress = 'http://heartbeat_server_test:3000';

    let heartbeat_cycle = 10;
    let heartbeat_data = {
      user_id: faker.random.number(1000),
      asset_id: faker.random.number(1000),
      session_id: faker.random.uuid(),
      heartbeat_cycle: heartbeat_cycle,
      cycle_upper_tolerance: 4,
      timestamp: (new Date()).toISOString(),
      session_limit: 1,
      checking_threshold: 3,
      sessions_edge: 5
    };

    let request_body = {
      heartbeat_token: cryptoAES.encrypt(heartbeat_data, SHARED_KEY),
      progress: faker.random.number(7200)
    };

    let response = await makeHeartbeatRequest(request_body, heartbeatServerAddress);
    assert.equal(response.status, 200);
    assert.equal(Object.keys(response.body).length, 1);
    assert(response.body.hasOwnProperty('heartbeat_token'));
  });


});


function makeHeartbeatRequest(request_body, url) {
  return chai.request(url)
    .post('/heartbeat')
    .type('application/json')
    .send(request_body);
}