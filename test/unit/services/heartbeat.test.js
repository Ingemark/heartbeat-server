var cryptoAES = require('../../../utils/cryptoAES')
  , chai = require('chai')
  , assert = chai.assert
  , faker = require('faker')
  , moment = require('moment')
  , rewire = require('rewire')
  , storageMock = require('../../../storages/mock')
  , heartbeatService = rewire('../../../services/heartbeat');

chai.use(require('chai-http'));

describe('Heartbeat service', function () {

  describe('#processRequest', function () {
    describe('when :heartbeat_token cannot be decrypted', function () {
      let notAcceptableResponse = heartbeatService.__get__('notAcceptableResponse');

      it('returns 406', async function () {
        let heartbeatData = {
          user_id: faker.random.number(1000),
          asset_id: faker.random.number(1000),
          session_id: faker.random.uuid(),
          heartbeat_cycle: 5,
          cycle_upper_tolerance: 4,
          timestamp: (new Date).toISOString(),
          session_limit: 1,
          checking_threshold: 3,
          sessions_edge: 5
        };
        let request = formHeartbeatRequest(heartbeatData, null, 'incorrectSharedKey');

        let result = await heartbeatService.processRequest(request, null, null, 'sharedKey');
        assert.deepEqual(result, notAcceptableResponse());
      })
    })
  });

  describe('#processHeartbeat', function () {
    let successfulResponse = heartbeatService.__get__('successfulResponse');
    let activeSessionLimitExceededResponse = heartbeatService.__get__('activeSessionLimitExceededResponse');
    let processHeartbeatData = function(heartbeatData, request, sharedKey, storageContent) {
      return (
        (heartbeatService.__get__('processHeartbeatData'))(heartbeatData, storageMock, request, sharedKey)
      )(storageContent);
    };
    let subtractTime = (timeISOString, value, unit) => moment(timeISOString).subtract(value, unit).toISOString();
    let timeNowISOString;
    beforeEach(function () {
      timeNowISOString = (new Date()).toISOString();
      heartbeatService.__set__('getTimeNowISOString', () => timeNowISOString);
    });

    describe('when storage content is empty and heartbeat data is valid', function () {
      it('returns 200', async function () {
        let heartbeatData = {
          user_id: faker.random.number(1000),
          asset_id: faker.random.number(1000),
          session_id: faker.random.uuid(),
          heartbeat_cycle: 5,
          cycle_upper_tolerance: 4,
          timestamp: timeNowISOString,
          session_limit: 1,
          checking_threshold: 3,
          sessions_edge: 5
        };
        let progress = 10;
        let request = formHeartbeatRequest(heartbeatData, progress, 'sharedKey');
        let storageContent = {
          sessions: {}
        };

        let result = await processHeartbeatData(heartbeatData, request, 'sharedKey', storageContent);
        assert.equal(result.status, successfulResponse().status);
        assert(result.body.hasOwnProperty('heartbeat_token'));
      });
    });

    describe('when user with :session_limit=1 reaches threshold with 2nd session', function () {
      it('returns 412', async function () {
        let heartbeatData = {
          user_id: faker.random.number(1000),
          asset_id: faker.random.number(1000),
          session_id: faker.random.uuid(),
          heartbeat_cycle: 10,
          cycle_upper_tolerance: 4,
          timestamp: timeNowISOString,
          session_limit: 1,
          checking_threshold: 3,
          sessions_edge: 5
        };
        let progress = 10;
        let request = formHeartbeatRequest(heartbeatData, progress, 'sharedKey');
        let storageContent = {
          sessions: {
            [heartbeatData.session_id]: {
              timestamp: subtractTime(heartbeatData.timestamp, 12, 's'),
              hit_counter: 3,
              started_at: subtractTime(heartbeatData.timestamp, 150, 's')
            },
            [faker.random.uuid()]: {
              timestamp: subtractTime(heartbeatData.timestamp, 11, 's'),
              hit_counter: 5,
              started_at: subtractTime(heartbeatData.timestamp, 180, 's')
            }
          }
        };

        let result = await processHeartbeatData(heartbeatData, request, 'sharedKey', storageContent);
        assert.deepEqual(result, activeSessionLimitExceededResponse());
      });
    });

    describe('when user with :session_limit=1 does not reach threshold with 2nd session', function () {
      it('returns 200', async function () {
        let heartbeatData = {
          user_id: faker.random.number(1000),
          asset_id: faker.random.number(1000),
          session_id: faker.random.uuid(),
          heartbeat_cycle: 10,
          cycle_upper_tolerance: 4,
          timestamp: timeNowISOString,
          session_limit: 1,
          checking_threshold: 3,
          sessions_edge: 5
        };
        let progress = 10;
        let request = formHeartbeatRequest(heartbeatData, progress, 'sharedKey');
        let storageContent = {
          sessions: {
            [heartbeatData.session_id]: {
              timestamp: subtractTime(heartbeatData.timestamp, 12, 's'),
              hit_counter: 2,
              started_at: subtractTime(heartbeatData.timestamp, 150, 's')
            },
            [faker.random.uuid()]: {
              timestamp: subtractTime(heartbeatData.timestamp, 11, 's'),
              hit_counter: 5,
              started_at: subtractTime(heartbeatData.timestamp, 180, 's')
            }
          }
        };

        let result = await processHeartbeatData(heartbeatData, request, 'sharedKey', storageContent);
        assert.equal(result.status, successfulResponse().status);
        assert(result.body.hasOwnProperty('heartbeat_token'));
      });
    });

  });
});

function formHeartbeatRequest(heartbeatData, progress, sharedKey) {
  return {
    body: {
      heartbeat_token: cryptoAES.encrypt(heartbeatData, sharedKey),
      progress: progress
    }
  };
}
