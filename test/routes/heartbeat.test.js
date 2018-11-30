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
let shared_key = process.env.SHARED_KEY = faker.internet.password(20);

let sandbox, clock, time_now;

let app = getApp();

describe('POST /heartbeat', function () {
  let heartbeat_data, request_body;

  beforeEach(function () {
    sandbox = sinon.sandbox.create();
    time_now = (new Date()).toISOString();
    clock = sinon.useFakeTimers((new Date(time_now)).getTime());
  });

  afterEach(function () {
    sandbox.restore();
    clock.restore();
  });

  it('returns 200 OK', function () {
    let heartbeat_cycle = 10;
    heartbeat_data = {
      user_id: faker.random.number(1000),
      asset_id: faker.random.number(1000),
      session_id: faker.random.uuid(),
      heartbeat_cycle: heartbeat_cycle,
      cycle_upper_tolerance: 4,
      timestamp: moment(time_now).toISOString(),
      session_limit: 1,
      checking_threshold: 3,
      sessions_edge: 5
    };

    request_body = {
      heartbeat_token: cryptoAES.encrypt(heartbeat_data, shared_key),
      progress: faker.random.number(7200)
    };

    let user_session_data = {
      sessions: {}
    };
    stubStorage('fetchUserSessionData', user_session_data);

    return makeHeartbeatRequest(request_body, function (response) {
      assert.equal(response.status, 200);
      assert.equal(Object.keys(response.body).length, 1);
      assert(response.body.hasOwnProperty('heartbeat_token'));
    });
  });

  it('returns 412 Precondition Failed', function () {
    let heartbeat_cycle = 10;
    heartbeat_data = {
      user_id: faker.random.number(1000),
      asset_id: faker.random.number(1000),
      session_id: faker.random.uuid(),
      heartbeat_cycle: heartbeat_cycle,
      cycle_upper_tolerance: 4,
      timestamp: moment(time_now).toISOString(),
      session_limit: 1,
      checking_threshold: 3,
      sessions_edge: 5
    };

    request_body = {
      heartbeat_token: cryptoAES.encrypt(heartbeat_data, shared_key),
      progress: faker.random.number(7200)
    };

    let user_session_data = {
      sessions: {
        [heartbeat_data.session_id]: {
          timestamp: moment(heartbeat_data.timestamp).subtract(12, 's').toISOString(),
          hit_counter: 5,
          started_at: moment(heartbeat_data.timestamp).subtract(30, 's').toISOString()
        },
        [faker.random.uuid()]: {
          timestamp: moment(heartbeat_data.timestamp).subtract(14, 's').toISOString(),
          hit_counter: 3,
          started_at: moment(heartbeat_data.timestamp).subtract(90, 's').toISOString()
        }
      }
    };
    stubStorage('fetchUserSessionData', user_session_data);

    return makeHeartbeatRequest(request_body, function (response) {
      assert.equal(response.status, 412);
    });
  });

  it('returns 406 Not Acceptable', function () {
    let heartbeat_cycle = 10;
    heartbeat_data = {
      user_id: faker.random.number(1000),
      asset_id: faker.random.number(1000),
      session_id: faker.random.uuid(),
      heartbeat_cycle: heartbeat_cycle,
      cycle_upper_tolerance: 4,
      timestamp: moment(time_now).toISOString(),
      session_limit: 1,
      checking_threshold: 3,
      sessions_edge: 5
    };

    request_body = {
      heartbeat_token: cryptoAES.encrypt(heartbeat_data, 'not the same key as expected'),
      progress: faker.random.number(7200)
    };

    let user_session_data = {
      session_limit: null,
      checking_threshold: null,
      sessions_edge: null,
      sessions: {}
    };
    stubStorage('fetchUserSessionData', user_session_data);

    return makeHeartbeatRequest(request_body, function (response) {
      assert.equal(response.status, 406);
    });
  });


  describe.skip('when heartbeat comes from backend', function () {
    beforeEach(function () {
      let heartbeat_cycle = 10;
      heartbeat_data = {
        user_id: faker.random.number(1000),
        asset_id: faker.random.number(1000),
        session_id: faker.random.uuid(),
        heartbeat_cycle: heartbeat_cycle,
        cycle_upper_tolerance: 4,
        timestamp: moment(time_now).toISOString(),
        session_limit: 1,
        checking_threshold: 3,
        sessions_edge: 5
      };

      request_body = {
        heartbeat_token: cryptoAES.encrypt(heartbeat_data, shared_key),
        progress: faker.random.number(7200)
      }
    });

    it('saves global parameters about user\'s sessions', function () {
      var user_session_data = {
        session_limit: null,
        checking_threshold: null,
        sessions_edge: null,
        sessions: {}
      }

      stubStorage('fetchUserSessionData', user_session_data);
      var spy_set_session_limit = spyStorage('setSessionLimit');
      var spy_set_checking_threshold = spyStorage('setCheckingThreshold');
      var spy_set_sessions_edge = spyStorage('setSessionsEdge');

      return makeHeartbeatRequest(request_body, function (response) {
        assert(spy_set_session_limit.withArgs(heartbeat_data.user_id,
          heartbeat_data.session_limit).calledOnce);
        assert(spy_set_checking_threshold.withArgs(heartbeat_data.user_id,
          heartbeat_data.checking_threshold).calledOnce);
        assert(spy_set_sessions_edge.withArgs(heartbeat_data.user_id,
          heartbeat_data.sessions_edge).calledOnce);
      });
    });

    it('creates a new session and updates the progress', function () {
      var user_session_data = {
        session_limit: null,
        checking_threshold: null,
        sessions_edge: null,
        sessions: {}
      }
      stubStorage('fetchUserSessionData', user_session_data)
      var spy_set_session = spyStorage('addPostAction');

      makeHeartbeatRequest(request_body, function (response) {
        assert.equal(response.status, 200);
        assert.equal(spy_set_session.args[0][2], heartbeat_data.session_id);
      });
    });

    it('updates the session', function () {
      var user_session_data = {
        session_limit: '1',
        checking_threshold: '3',
        sessions_edge: '15',
        sessions: {
          [heartbeat_data.session_id]: {
            timestamp: moment(heartbeat_data.timestamp).subtract(12, 's').toISOString(),
            hit_counter: 1,
            started_at: moment(heartbeat_data.timestamp).subtract(30, 's').toISOString()
          }
        }
      }

      stubStorage('fetchUserSessionData', user_session_data);
      var spy_set_session = spyStorage('setSession');
      var spy_update_progress = spyStorage('updateProgress');

      return makeHeartbeatRequest(request_body, function (response) {
        assert.equal(spy_set_session.args[0][2].hit_counter, 2);
        assert.sameOrderedMembers(spy_update_progress.args[0], [heartbeat_data.user_id,
          heartbeat_data.asset_id, request_body.progress]);
        assert.equal(response.status, 200);
      });
    });

  });

  describe.skip('when heartbeat comes from heartbeat server', function () {

  });


});


function makeHeartbeatRequest(request_body, callback) {
  return chai.request(app)
    .post('/heartbeat')
    .type('application/json')
    .send(request_body)
    .then(callback)
    .catch(callback);
}

function getApp() {
  return require('../../app');
}

function stubStorage(functionName, user_session_data) {
  sandbox.stub(storageMock, functionName).callsFake(function () {
    return new Promise((resolve, reject) => {
      resolve(user_session_data);
    });
  });
}

function spyStorage(functionName) {
  return sandbox.spy(storageMock, functionName);
}


function setUserSessionData(config) {
  return {
    session_limit: '1',
    checking_threshold: '3',
    sessions_edge: '15',
    sessions: {
      [heartbeat_data.session_id]: {
        timestamp: moment(heartbeat_data.timestamp).add(12, 's').toISOString(),
        hit_counter: 1,
        started_at: moment(heartbeat_data.timestamp).subtract(30, 's').toISOString()
      }
    }
  }
}
