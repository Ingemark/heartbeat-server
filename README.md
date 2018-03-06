# Heartbeat Server

Component used for OTT applications to limit number of parallel streaming
sessions per registered user, remember the progress where user stopped last time and
provide data to analyze detailed play history.

### Requirements

- `nodejs`, version **6.10.3** (latest supported by AWS Lambda)
  - install via `nvm` (recommended) or any other source
- `redis` server, tested with version **3.0.6** (for now, the only supported
in-memory storage)

### Configuration

- create `.env` file in root directory
    - `.env.example` file is an example of configuration
    `.env` file
    - `STORAGE` is the only required key, while others
    are optional
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
