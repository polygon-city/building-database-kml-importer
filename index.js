var _ = require("lodash");
var argv = require("minimist")(process.argv.slice(2));
var inquirer = require("inquirer");
var JXON = require("jxon");
var fs = require("fs");
var async = require("async");
var request = require("request");

var config;
var kmlPath;

if (!argv || (!argv.k && !argv.kml) ||) {
  console.log("Path to KML file must be provided via the -k or --kml flag.")
  process.exit(0);
} else {
  kmlPath = (argv.k) ? argv.k : argv.kml;
  console.log("KML path:", kmlPath);
}

// TODO: Set buildings as hidden until confirmed as correct
// TODO: Set buildings as visible using another script when happy
// TODO: Resume uploads after failure, even if script has crashed
// https://github.com/polygon-city/building-database-kml-importer/issues/2

// TODO: Fix ENOENT error where tmp files are deleted before being finished with
// TODO: Fix { error: 'An error occurred during conversion' }

// For storing login session cookie
var cookieJar;
// Batch ID for upload
var batchID;
// Buildings to exclude from batch
var batchExclude;
var creator;
var creatorURL;
var method;
var description;
var filePrefix;

var questions = [
  {
    type: "input",
    name: "creator",
    message: "Who created this?",
    validate: function(value) {
      var valid = (value.toString().length > 0);
      return valid || "Please enter a string";
    },
    filter: String
  }, {
    type: "input",
    name: "creatorURL",
    message: "What URL was used to download the data?",
    validate: function(value) {
      var valid = (value.toString().length > 0);
      return valid || "Please enter a string";
    },
    filter: String
  }, {
    type: "input",
    name: "description",
    message: "How would you describe the data?",
    validate: function(value) {
      var valid = (value.toString().length > 0);
      return valid || "Please enter a string";
    },
    filter: String
  }, {
    type: "input",
    name: "polygonCityURL",
    message: "What is the Polygon City URL?",
    default: function () { return "http://localhost:3000"; },
    validate: function(value) {
      var valid = (value.toString().length > 0);
      return valid || "Please enter a string";
    },
    filter: String
  }, {
    type: "input",
    name: "polygonCityUser",
    message: "Which Polygon City username should be used?",
    validate: function(value) {
      var valid = (value.toString().length > 0);
      return valid || "Please enter a string";
    },
    filter: String
  }, {
    type: "password",
    name: "polygonCityPass",
    message: "What is the password for that username?",
    validate: function(value) {
      var valid = (value.toString().length > 0);
      return valid || "Please enter a string";
    },
    filter: String
  }, {
    type: "confirm",
    name: "batchContinue",
    message: "Do you want to continue from an existing batch?",
    default: false
  }, {
    type: "input",
    name: "batchID",
    message: "What is the batch ID to continue from?",
    validate: function(value) {
      var valid = (value.toString().length > 0);
      return valid || "Please enter a string";
    },
    filter: String,
    when: function(answers) {
      return answers.batchContinue;
    }
  }
];

var getConfig = function() {
  return function(cb) {
    process.nextTick(function() {
      fs.exists("./config.js", function(exists) {
        if (exists) {
          config = require("./config.js");
          cb(null);
        } else {
          inquirer.prompt(questions, function(answers) {
            config = answers;
            cb(null);
          });
        }
      });
    });
  };
};

var setVariables = function() {
  return function(cb) {
    process.nextTick(function() {
      // For storing login session cookie
      cookieJar = request.jar();

      // Batch ID for upload
      batchID = (config.batchID) ? config.batchID.toString() : "";

      // Buildings to exclude from batch
      batchExclude = [];

      creator = config.creator;
      creatorURL = config.creatorURL;
      method = "automated";
      description = config.description;

      filePrefix = kmlPath.split(/[\w-_]+\.kml/)[0];

      console.log(JSON.stringify(config, null, "  "));

      cb(null);
    });
  };
};

var checkConfig = function() {
  return function(cb) {
    process.nextTick(function() {
      // Check for required settings
      if (config) {
        var fail = false;

        if (!config.creator) {
          console.log("Required creator tag missing");
          fail = true;
        }

        if (!config.creatorURL) {
          console.log("Required creator URL tag missing");
          fail = true;
        }

        if (!config.description) {
          console.log("Required description tag missing");
          fail = true;
        }

        if (!config.polygonCityURL) {
          console.log("Required Polygon City URL missing");
          fail = true;
        }

        if (!config.polygonCityUser) {
          console.log("Required Polygon City username missing");
          fail = true;
        }

        if (!config.polygonCityPass) {
          console.log("Required Polygon City password missing");
          fail = true;
        }

        if (fail) {
          process.exit(1);
        } else {
          cb(null);
        }
      } else {
        console.log("Required config missing");
        process.exit(1);
      }
    });
  };
};

// Queue processing 10 buildings at a time
// TODO: POST building data: http://stackoverflow.com/a/25345124/997339
// TODO: Send location data POST request after successful file upload
var buildingQueue = async.queue(function(building, done) {
  var formData = {
    name: building.name,
    model: fs.createReadStream(filePrefix + building.model),
    creator: building.creator,
    creatorURL: building.creatorURL,
    method: building.method,
    description: building.description,
    // Leave original scale, assuming units are in metres already
    scale: 1,
    angle: building.angle,
    latitude: building.latitude,
    longitude: building.longitude,
    batchID: building.batchID
  };

  request.post({
    url: config.polygonCityURL + "/api/buildings",
    jar: cookieJar,
    formData: formData
  }, function(err, res, body) {
    if (err) {
      // Skip on error
      // This is mostly the socket hangup error (issue #1) and often the
      // building has still been added successfully.
      //throw err;
      console.error(err);
      console.log("Skipping building");
      done();
      return;
    }

    var savedBuilding = JSON.parse(body);

    // Skip on errors for now
    // Likely a line-by-line error which can be ignored
    // Though it does seem to cause some buildings not to successfully upload
    // TODO: Work out how to avoid this error entirely
    if (savedBuilding.error) {
      console.log("Skipping error:", savedBuilding.error);
      done();
      return;
    }

    console.log(savedBuilding);

    done();
  });
}, 10);

// Login to Polygon City
// TODO: Authenticate with something more robust like OAuth
var login = function() {
  return function (cb) {
    process.nextTick(function() {
      request.post({
        url: config.polygonCityURL + "/login",
        jar: cookieJar,
        form: {
          username: config.polygonCityUser,
          password: config.polygonCityPass
        }
      }, function(err, res, body) {
        if (err) {
          throw err;
        }

        // Hacky check to see if logged in
        if (body === "Moved Temporarily. Redirecting to /login") {
          cb(new Error("Login failed, check credentials are correct."));
          return;
        }

        console.log("Logged in username:", config.polygonCityUser);

        // TODO: Only callback if login was a success
        cb(null, body);
      });
    });
  };
};

var getBatchID = function(cb) {
  process.nextTick(function() {
    console.log("Requesting batch ID");

    request.get({
      url: config.polygonCityURL + "/api/batch/id",
      jar: cookieJar
    }, function(err, res, body) {
      if (err) {
        throw err;
      }

      var bodyJSON = JSON.parse(body);

      if (!bodyJSON || !bodyJSON.id) {
        cb(new Error("Unable to request batch ID"));
        return;
      }

      batchID = bodyJSON.id;

      console.log("Batch ID:", batchID);

      cb(null, batchID);
    });
  });
};

var getBatch = function(cb) {
  process.nextTick(function() {
    console.log("Requesting existing batch");

    if (!batchID) {
      cb(new Error("Batch ID not found"));
      return;
    }

    request.get({
      url: config.polygonCityURL + "/api/batch/" + batchID,
      jar: cookieJar
    }, function(err, res, body) {
      if (err) {
        throw err;
      }

      var bodyJSON = JSON.parse(body);
      batchExclude = bodyJSON;

      console.log("Batch ID:", batchID);
      console.log("Batch:", _.pluck(bodyJSON, "name"));

      cb(null, bodyJSON);
    });
  });
};

var readKML = function(path) {
  return function (cb) {
    process.nextTick(function() {
      if (!batchID) {
        cb(new Error("Batch ID not found"));
        return;
      }

      fs.readFile(path, "utf-8", function(err, data) {
        if (err) {
          console.log("Unable to open KML file");
          throw err;
        }
        
        var jxon = JXON.stringToJs(data);

        if (!jxon) {
          throw new Error("Error in JXON conversion");
        }

        if (!jxon.kml || !jxon.kml.document) {
          throw new Error("File is missing <kml> and <document> elements");
        }

        var kml = jxon.kml.document;

        _.each(kml.placemark, function(placemark) {
          // TODO: Find something other than name to rely on as this can be changed manually after upload - perhaps batch.ref?
          var exclude = _.find(batchExclude, function(building) {
            return (building.name === placemark.name);
          });

          if (exclude) {
            console.log("Skipping building as already uploaded:", placemark.name);
            return;
          }

          var output = {};

          output.name = placemark.name;
          output.model = placemark.model.link.href;
          output.creator = creator;
          output.creatorURL = creatorURL;
          output.method = method;
          output.description = description;
          output.latitude = placemark.model.location.latitude,
          output.longitude = placemark.model.location.longitude,
          output.angle = placemark.model.orientation.heading
          output.batchID = batchID;

          // Add building to queue
          buildingQueue.push(output);
        });
      
        cb(null);
      });
    });
  };
};

// TODO: Not working
var startBatch = function() {
  return function (cb) {
    process.nextTick(function() {
      var func = (batchID) ? getBatch : getBatchID;
      func(function(err) {
        cb(err)
      });
    });
  };
};

// TODO: Should this be a waterfall instead so the login cookie and batch ID can be passed along?
// TODO: If batch ID is provided on load, check current status and only upload buildings that haven't been added (eg. that aren't returned)
async.series([
  getConfig(),
  checkConfig(),
  setVariables(),
  login(),
  startBatch(),
  readKML(kmlPath)
], function(err, results) {
  if (err) {
    throw err;
  }
});