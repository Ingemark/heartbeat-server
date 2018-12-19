var cryptoAES = require('../../utils/cryptoAES')
  , chai = require('chai')
  , assert = chai.assert
  , faker = require('faker')
  , sinon = require('sinon')
  , heartbeatService = require('../../services/heartbeat');

chai.use(require('chai-http'));

let sandbox;

describe('POST /heartbeat', function () {
  beforeEach(function () {
    sandbox = sinon.sandbox.create();
  });

  afterEach(function () {
    sandbox.restore();
  });

  it('returns 200 OK', async function () {
    let request_body = {
      heartbeat_token: cryptoAES.encrypt({ heartbeatData: {} }, 'sharedKey'),
      progress: faker.random.number(7200)
    };

    let processRequestResponse = {
      status: 200,
      body: {
        heartbeat_token: cryptoAES.encrypt({ newHeartbeatData: { } }, 'sharedKey')
      }
    };
    let stubProcessRequest = stubFunctionCall(heartbeatService, 'processRequest', processRequestResponse);

    let response = await makeHeartbeatRequest(request_body);

    assert(stubProcessRequest.args[0][0].body, request_body);
    assert.equal(response.status, processRequestResponse.status);
    assert.deepEqual(response.body, processRequestResponse.body);
  });
});


function makeHeartbeatRequest(request_body) {
  return chai.request(require('../../app'))
    .post('/heartbeat')
    .type('application/json')
    .send(request_body);
}

function stubFunctionCall(object, functionName, returnValue) {
  return sandbox.stub(object, functionName).callsFake(function () {
    return new Promise((resolve, reject) => {
      resolve(returnValue);
    });
  });
}
