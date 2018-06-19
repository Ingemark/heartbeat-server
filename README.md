# Heartbeat Server

Component used for OTT applications to limit the number of parallel streaming
sessions per registered user, remember the progress where user stopped last time and
provide data to analyze detailed play history.

##Development
### Requirements

- `nodejs`, version **8.10.0**+
  - install via `nvm` (recommended) or any other source
- `redis` server, tested with version **3.0.6** (for now, the only supported
in-memory storage)

### Configuration

- create `.env` file in root directory
    - `.env.example` file is an example of configuration `.env` file
    - `PORT`, `SHARED_KEY` and `STORAGE` are required, while others are optional
```
# get dependencies
npm install
```

### Running the server

```bash
# start the system for development
npm start

# start the system for production
npm run startProd
```

## Testing

```bash
# run tests with mocha
npm test
```

## Deployment

Clone repository to machine where system will be deployed. Create and configure `.env`
file. 

Install next dependencies:

- `docker` ([official instructions](https://docs.docker.com/install/))
- `docker-compose` ([official instructions](https://docs.docker.com/compose/install/))

```bash
# build (rebuild) and start heartbeat server
docker-compose up --build
```

Heartbeat server will be ready on port specified in `PORT` variable inside `.env` file.

## Specification of other components

Heartbeat server needs configured clients and backend server to work properly. 

![System architecture](./architecture-storages-english.png)

### Client specification

The process starts with requesting resource URL from backend. Along with resource id, user authentication token and
other necessary data, backend responds with: `heartbeat_token`, `heartbeat_cycle` and `progress`.

Client saves `heartbeat_token` in local storage and begins to reproduce the resource at position defined 
by `progress` variable (which describes the time elapsed from beginning of the resource). In the same moment, 
client sets periodic timer with period of time defined in `heartbeat_cycle` variable. Periodic timer is active 
during entire player session. 

Every time when timer expires, client sends request to heartbeat server.

```
POST https://path.to.heartbeat.server/

Headers:
    Content-Type: "application/json"

Request body:
{
  "heartbeat_token": "U2FsdGVkX1...", // last received heartbeat_token
  "progress": 42                      // current progress of playing content
}
```

Path to heartbeat server has to be hardcoded into client application. `heartbeat_token` represents the last received
token from heartbeat server or backend that is located in local storage. `progress` stands for number of seconds
elapsed from beginning of playing content in the moment of sending the heartbeat.

Heartbeat server responds in two different ways; positive and negative

#### Positive response

When response is positive, it means that client receives new `heartbeat_token` and continues to reproduce current
content. Newly received `heartbeat_token` has to be saved in local storage and be used for next heartbeat request.

```
Status: 200 OK
Response body:
{
    "heartbeat_token": "VkX1844Ibx..." // new heartbeat token
}
```

#### Negative response

When response is negative, it means that client has to stop reproducing the content and inform user about reasons.
The negative response contains appropriate message to the user. The message always remains the same, so client
application can rely on HTTP status code (412 Precondition Failed).

```
Status: 412 Precondition Failed
Response body:
{
  "error": "Your session limit has been exceeded."
}
```

### Backend specification

