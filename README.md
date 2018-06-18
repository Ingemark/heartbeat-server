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

