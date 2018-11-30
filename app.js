var express = require('express');
var morganLogger = require('morgan');
var bodyParser = require('body-parser');

// Custom routes
var heartbeat = require('./routes/heartbeat');

var logger = require('./utils/logger');
var app = express();

app.use(morganLogger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

app.use('/', heartbeat);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// error handler
app.use(function(err, req, res, next) {
  let status = err.status || 500;
  if (status == 500) logger.error(err.stack);

  // render the error page
  res.status(status);
  res.send();
});

module.exports = app;
