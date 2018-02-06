var cryptoAES = require('../../utils/cryptoAES')
  , chai = require('chai')
  , assert = chai.assert
  , faker = require('faker')
  , moment = require('moment')
  , sinon = require('sinon')
  , storageMock = require('../../storages/mock');

chai.use(require('chai-http'));

process.env.STORAGE = 'mock';
process.env.DEV_LOG_LEVEL = 'verbose';
var shared_key = process.env.SHARED_KEY = faker.internet.password(20);

var app = getApp();

describe('POST /heartbeat', function () {
  var time_now, heartbeat_data, request_body;

  describe('when heartbeat comes from backend', function () {

    beforeEach(function () {
      time_now = moment().toISOString();
      let heartbeat_cycle = 10;
      heartbeat_data = {
        user_id: faker.random.number(1000),
        asset_id: faker.random.number(1000),
        session_id: faker.random.uuid(),
        heartbeat_cycle: heartbeat_cycle,
        cycle_upper_tolerance: 4,
        timestamp: time_now,
        session_limit: 0,
        checking_threshold: 3,
        sessions_edge: 5
      }

      request_body = {
        heartbeat_token: cryptoAES.encrypt(heartbeat_data, shared_key),
        progress: faker.random.number(7200)
      }
    });

    it('hellos', function () {
      console.log(request_body);

      stubStorage('fetchUserSessionData', function () {
        return new Promise((resolve, reject) => {
          user_session_data = {
            session_limit: '0',
            checking_threshold: '3',
            sessions_edge: '15',
            sessions:
              { 'f07eb492-4b10-4d2f-a846-05015826053e':
                { timestamp: '2018-02-06T18:42:56.117Z',
                  hit_counter: 6,
                  started_at: '2018-02-06T18:42:50.968Z' }
              }
          }
          resolve(user_session_data);
        });

      });

      makeHeartbeatRequest(request_body, function (err, res) {
        console.log('here');
      });
      assert(true, true);
    })

  });

  describe('when heartbeat comes from heartbeat server', function () {

  });

});


function makeHeartbeatRequest(request_body, callback) {
  chai.request(app)
    .post('/heartbeat')
    .type('application/json')
    .send(request_body)
    .end(callback);
}

function getApp() {
  return require('../../app');
}

function stubStorage(functionName, mockFunction) {
  sinon.stub(storageMock, functionName).callsFake(function () {
    return mockFunction();
  })
  }