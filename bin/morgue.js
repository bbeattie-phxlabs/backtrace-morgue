#!/usr/bin/env node

'use strict';

const CoronerClient = require('../lib/coroner.js');
const crdb      = require('../lib/crdb.js');
const minimist  = require('minimist');
const os        = require('os');
const bar       = require('./bar.js');
const timeago   = require('time-ago');
const histogram = require('./histogram.js');
const printf    = require('printf');
const moment    = require('moment');
const colors    = require('colors');
const fs        = require('fs');
const mkdirp    = require('mkdirp');
const prompt    = require('prompt');
const path      = require('path');
const bt        = require('backtrace-node');

var error = colors.red;
var ta = timeago();
var range_start = null;
var range_stop = null;
var reverse = 1;
const configDir = path.join(os.homedir(), ".coroner-node");
const configFile = path.join(configDir, "current.json");

bt.initialize({
  timeout: 5000,
  endpoint: "https://yolo.sp.backtrace.io:6098",
  token: "73092adaab1f194c5db5449080d9fda5fab8e319f83fa60d25315d5ea082cfa1"
});

function usage() {
  console.error("Usage: morgue <command> [<arguments>]");
  process.exit(1);
}

var commands = {
  error: coronerError,
  list: coronerList,
  ls: coronerList,
  describe: coronerDescribe,
  get: coronerGet,
  login: coronerLogin,
};

main();

function coronerError(argv, config) {
  if (argv._.length < 2) {
    console.error("Missing error string".error);
    process.exit(1);
  }

  throw Error(argv._[1]);
}

function saveConfig(coroner, callback) {
  makeConfigDir(function(err) {
    if (err) return callback(err);

    var config = {
      config: coroner.config,
      endpoint: coroner.endpoint,
    };
    var text = JSON.stringify(config, null, 2);
    fs.writeFile(configFile, text, callback);
  });
}

function loadConfig(callback) {
  makeConfigDir(function(err) {
    if (err) return callback(err);

    fs.readFile(configFile, {encoding: 'utf8'}, function(err, text) {
      var json;
      try {
        json = JSON.parse(text);
      } catch (err) {
        return callback(new Error("config file invalid JSON: " + err.message));
      };
      callback(null, json);
    });
  });
}

function makeConfigDir(callback) {
  mkdirp(configDir, {mode: "0700"}, callback);
}

function abortIfNotLoggedIn(config) {
  if (config && config.config && config.config.token) return;

  console.error('Must login first.'.error);
  process.exit(1);
}

function coronerGet(argv, coroner) {

}

function coronerDescribe(argv, config) {
  abortIfNotLoggedIn(config);

  var query = {};
  var universe = null;
  var project = null;
  var filter = null;

  const insecure = !!argv.k;
  const debug = argv.debug;

  var coroner = new CoronerClient({
    insecure: insecure,
    debug: debug,
    config: config.config,
    endpoint: config.endpoint,
  });

  if (argv._.length < 2) {
    console.error("Missing project and universe arguments".error);
    return usage();
  }

  if (Array.isArray(argv._) === true) {
    var split;

    split = argv._[1].split('/');
    if (split.length === 1) {
      /* Try to automatically derive a path from the one argument. */
      universe = config.config.universes[0];
      project = argv._[1];
    } else {
      universe = split[0];
      project = split[1];
    }

    if (argv._[2])
      filter = argv._[2];
  }

  coroner.describe(universe, project, function (error, result) {
    var cd, i;
    var ml = 0;

    if (error) {
      var message = 'Error: ';
      if (error.message) {
        message += error.message;
      } else {
        message += error;
      }

      if (error === 'invalid token')
        message = message + ': try logging in again.';

      console.log(message.error);
      process.exit();
    }

    cd = result.describe;
    for (i = 0; i < cd.length; i++) {
      var it = cd[i];

      if (it.name.length > ml)
        ml = it.name.length;
    }

    cd.sort(function(a, b) {
      if (a.custom === true && b.custom === false)
        return 1;
      if (a.custom === false && b.custom === true)
        return -1;

      return a.name.localeCompare(b.name);
    });

    for (i = 0; i < cd.length; i++) {
      var it = cd[i];
      var name, description;

      if (filter && it.name.match(filter) === null)
        continue;

      name = printf("%*s", it.name, ml);
      if (it.custom === true) {
        process.stdout.write(name.blue + ': ' + it.description);
      } else {
        process.stdout.write(name.yellow + ': ' + it.description);
      }
      if (it.format)
        process.stdout.write(' ['.grey + it.format.grey + ']'.grey);
      process.stdout.write('\n');
    }
  });
}

/**
 * @brief: Implements the list command.
 */
function coronerList(argv, config) {
  abortIfNotLoggedIn(config);

  var query = {};
  var universe = null;
  var project = null;
  var columns = {};

  const insecure = !!argv.k;
  const debug = argv.debug;

  var coroner = new CoronerClient({
    insecure: insecure,
    debug: debug,
    config: config.config,
    endpoint: config.endpoint,
  });

  if (argv._.length < 2) {
    console.error("Missing project and universe arguments".error);
    return usage();
  }

  if (Array.isArray(argv._) === true) {
    var split;

    split = argv._[1].split('/');
    if (split.length === 1) {
      /* Try to automatically derive a path from the one argument. */
      universe = config.config.universes[0];
      project = argv._[1];
    } else {
      universe = split[0];
      project = split[1];
    }
  }

  if (argv.reverse)
    reverse = -1;

  query.filter = [{}];
  if (argv.filter) {
    var i;

    if (Array.isArray(argv.filter) === false)
      argv.filter = [argv.filter];

    for (i = 0; i < argv.filter.length; i++) {
      var r = argv.filter[i];

      r = r.split(',');
      if (r.length < 3) {
        console.log('Error: filter must be of form <column>,<operation>,<value>'.red);
        process.exit();
      }

      if (!query.filter[0][r[0]])
        query.filter[0][r[0]] = [];
      query.filter[0][r[0]].push([r[1], r[2]]);
    }
  }

  if (!query.filter[0]['timestamp'])
    query.filter[0]['timestamp'] = [];
  query.filter[0]['timestamp'].push([ 'greater-than', 0 ]);

  if (argv.factor) {
    query.group = [ argv.factor ];
  }

  if (argv.select) {
    if (!query.select)
      query.select = [];

    if (Array.isArray(argv.select) === true) {
      var i;

      for (i = 0; i < argv.select.length; i++) {
        query.select.push(argv.select[i]);
      }
    } else {
      query.select = [ argv.select ];
    }
  } else {
    query.fold = {
      'timestamp' : [['range'], ['bin']]
    };
  }

  if (argv.age) {
    var now = new Date();
    var unit = {
      'y' : 3600 * 24 * 365,
      'M' : 3600 * 24 * 30,
      'w' : 3600 * 24 * 7,
      'd' : 3600 * 24,
      'h' : 3600,
      'm' : 60,
      's' : 1
    };
    var age = parseInt(argv.age);
    var pre = new String(age);
    var age_string = new String(argv.age);
    var iu = age_string.substring(pre.length, age_string.length);
    var target = Date.now() - (age * unit[iu] * 1000);

    query.filter[0].timestamp = [
      [ 'at-least', target / 1000 ]
    ];

    range_start = target / 1000;
    range_stop = Date.now() / 1000;
  }

  function fold(query, attribute, label, cb) {
    var argv, i;

    if (!query.fold)
      query.fold = {};

    if (Array.isArray(attribute) === false) {
      attribute = [ attribute ];
    }

    for (i = 0; i < attribute.length; i++) {
      argv = attribute[i];

      if (!query.fold[argv])
        query.fold[argv] = [];

      query.fold[argv].push([label]);
      columns[label + '(' + argv + ')'] = cb;
    }
  }

  if (argv.head)
    fold(query, argv.head, 'head', headPrint);
  if (argv.histogram)
    fold(query, argv.histogram, 'histogram', histogramPrint);
  if (argv.unique)
    fold(query, argv.unique, 'unique', uniquePrint);
  if (argv.quantize)
    fold(query, argv.quantize, 'bin', binPrint);
  if (argv.range)
    fold(query, argv.range, 'range', rangePrint);
  if (argv.bin)
    fold(query, argv.bin, 'bin', binPrint);

  if (argv.query) {
    var pp = JSON.stringify(query);

    console.log(pp);
    if (!argv.raw)
      process.exit(0);
  }

  coroner.query(universe, project, query, function (error, result) {
    var rp;

    if (error) {
      var message = 'Error: ';
      if (error.message) {
        message += error.message;
      } else {
        message += error;
      }

      if (error === 'invalid token')
        message = message + ': try logging in again.';

      console.log(message.error);
      process.exit();
    }

    if (argv.raw) {
      var pp;

      try {
        pp = JSON.stringify(result);
      } catch (error) {
        pp = result;
      }

      console.log(pp);
      process.exit(0);
    }

    rp = new crdb.Response(result);

    coronerPrint(query, rp.unpack(), argv.sort, argv.limit, columns);
  });
}

function rangePrint(field, factor) {
  console.log(field[0] + " - " + field[1] + " (" +
      (field[1] - field[0]) + ")");
}

function binPrint(field, factor) {
  var data = {};
  var j = 0;
  var i;
  var format = "%12d %12d";

  if (field.length === 0)
    return false;

  for (i = 0; i < field.length; i++) {
    var label;

    if (field[i].length === 0)
      continue;

    label = printf(format, field[i][0], field[i][1]);
    data[label] = field[i][2];
    j++;
  }

  if (j === 0)
    return false;

  process.stdout.write('\n');
  console.log(histogram(data, {
    'sort' : false,
    'width' : 10,
    'bar' : '\u2586'
  }));

  return true;
}

function histogramPrint(field) {
  var data = {};
  var j = 0;
  var i;

  for (i = 0; i < field.length; i++) {
    if (field[i].length === 0)
      continue;

    data[field[i][0]] = field[i][1];
    j++;
  }

  if (j === 0)
    return false;

  process.stdout.write('\n');
  console.log(histogram(data, {
    'sort' : true,
    'bar' : '\u2586',
    'width' : 40,
  }));

  return true;
}

function uniquePrint(field) {
  console.log(field[0]);
}

function headPrint(field) {
  console.log(field[0]);
}

function callstackPrint(cs) {
  var callstack;
  var frames, i, length;

  try {
    callstack = JSON.parse(cs);
  } catch (error) {
    console.log(' ' + callstack);
    return;
  }

  frames = callstack['frame'];
  if (frames === undefined) {
    console.log(cs);
    return;
  }

  process.stdout.write('\n    ');

  length = 4;
  for (i = 0; i < frames.length; i++) {
    length += frames[i].length + 4;

    if (i !== 0 && length >= 76) {
      process.stdout.write('\n    ');
      length = frames[i].length + 4;
    }

    if (i === frames.length - 1) {
      process.stdout.write(frames[i]);
      break;
    }

    process.stdout.write(frames[i] + ' ← ');
  }

  process.stdout.write('\n');
}

function objectPrint(g, object, columns) {
  var string = new String(g);
  var field, start, stop, sa;

  if (string.length > 28) {
    string = printf("%-28s...", string.substring(0, 28));
  } else {
    string = printf("%-31s", string);
  }

  process.stdout.write(string.factor + ' ');

  /* This means that no aggregation has occurred. */
  if (Object.keys(columns).length === 0) {
    var i;
    var a;

    process.stdout.write('\n');

    for (i = 0; i < object.length; i++) {
      var ob = object[i];
      var label = printf("#%-7x ", ob.object);

      process.stdout.write(label.green.bold);

      if (ob['timestamp']) {
        process.stdout.write(new Date(ob['timestamp'] * 1000) + '     ' +
            ta.ago(ob['timestamp'] * 1000).bold + '\n');
      }

      for (a in ob) {
        if (a === 'object')
          continue;

        if (a === 'timestamp')
          continue;

        if (a === 'callstack')
          continue;

        console.log('  ' + a.yellow.bold + ': ' + ob[a]);
      }

      /*
       * If a callstack is present then render it in a pretty fashion.
       */
      if (ob['callstack']) {
        process.stdout.write('  callstack:'.yellow.bold);
        callstackPrint(ob['callstack']);
      }
    }
  }

  var timestamp_bin = object['bin(timestamp)'];
  if (timestamp_bin) {
    bar(timestamp_bin, range_start, range_stop);
    process.stdout.write(' ');
  }

  var timestamp_range = object['range(timestamp)'];
  if (timestamp_range) {
    start = new Date(timestamp_range[0] * 1000);
    stop = new Date(timestamp_range[1] * 1000);
    sa = ta.ago(stop) + '\n';

    process.stdout.write(sa.success);
  }

  if (timestamp_range) {
    console.log('Date: '.label + start);
    if (timestamp_range[0] !== timestamp_range[1])
      console.log('      ' + stop);
  }

  if (object['count'])
      console.log('count: '.yellow.bold + object['count']);

  for (field in columns) {
    var handler = columns[field];
    var label;

    if (!object[field])
      continue;

    if (field.indexOf('callstack') > -1) {
      process.stdout.write('callstack:'.yellow.bold);
      callstackPrint(object[field]);
      continue;
    }

    process.stdout.write(field.label + ': '.yellow.bold);
    if (handler(object[field], field.label) === false)
      console.log('none');
  }
}

function range_compare(a, b, sort) {
  return reverse * ((a[1][sort][1] < b[1][sort][1]) -
      (a[1][sort][1] > b[1][sort][1]));
}

function unique_compare(a, b, sort) {
  return reverse * ((a[1][sort][0] < b[1][sort][0]) -
      (a[1][sort][0] > b[1][sort][0]));
}

function id_compare(a, b) {
  return reverse * ((a < b) - (a > b));
}

function coronerPrint(query, results, sort, limit, columns) {
  var g;

  if (results == {})
    return;

  if (sort) {
    var array = [];
    var i, sf, transform;

    for (g in results) {
      array.push([g, results[g]]);
    }

    if (array.length === 0) {
      console.log('No results.');
      return;
    }

    transform = id_compare;

    /* Determine sort factor. */
    if (array[0][1]['range(' + sort + ')']) {
      transform = range_compare;
      sf = 'range(' + sort + ')';
    } else if (array[0][1]['unique(' + sort + ')']) {
      transform = unique_compare;
      sf = 'unique(' + sort + ')';
    }

    array.sort(function(a, b) {
      return transform(a, b, sf);
    });

    var length = array.length;
    if (limit && limit < length)
      length = limit;

    for (i = 0; i < length; i++) {
      objectPrint(array[i][0], array[i][1], columns);
      process.stdout.write('\n');
    }

    return;
  }

  for (g in results) {
    objectPrint(g, results[g], columns);
    if (limit && --limit == 0)
      break;
    process.stdout.write('\n');
  }

  return;
}

/**
 * @brief Implements the login command.
 */
function coronerLogin(argv, config) {
  const endpoint = argv._[1];
  const insecure = !!argv.k;
  const debug = argv.debug;

  if (!endpoint) {
    console.error("Expected endpoint argument".error);
    return usage();
  }

  const coroner = new CoronerClient({
    endpoint: endpoint,
    insecure: insecure,
    debug: debug,
  });

  prompt.get([{
      name: 'username',
      message: 'User',
      required: true,
    }, {
      message: 'Password',
      name: 'password',
      replace: '*',
      hidden: true,
      required: true
  }], function (err, result) {
    if (err) {
      if (err.message == "canceled") {
        process.exit(0);
      } else {
        throw err;
      }
    }

    coroner.login(result.username, result.password, function(err) {
      if (err) {
        console.error(("Unable to authenticate: " + err.message).error);
        process.exit(1);
      }

      saveConfig(coroner, function(err) {
        if (err) {
          console.error(("Unable to save config: " + err.message).error);
          process.exit(1);
        }

        console.log('Logged in.'.success);
      });
    });
  });
}

function main() {
  var commandName = process.argv[2];
  var command = commands[commandName];
  if (!command) return usage();

  prompt.message = '';
  prompt.delimiter = ':';
  prompt.colors = false;
  prompt.start();

  colors.setTheme({
    error: [ 'red', 'bold' ],
    success: [ 'blue', 'bold' ],
    factor: [ 'bold' ],
    label : [ 'bold', 'yellow' ],
    dim: [ '' ]
  });

  var argv = minimist(process.argv.slice(2), {
    "boolean": ['k', 'debug'],
  });

  loadConfig(function(err, config) {
    if (err && err.code !== 'ENOENT') {
      console.error(("Unable to read config" + err.message).error);
      process.exit(1);
    }

    command(argv, config);
  });
}

//-- vim:ts=2:et:sw=2
