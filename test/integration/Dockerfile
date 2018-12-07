FROM node:8

RUN npm install -g mocha
RUN npm install chai chai-http faker crypto-js --save

WORKDIR /tests

CMD mocha /tests/*.js --exit
