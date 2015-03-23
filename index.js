var _ = require("lodash");
var JXON = require("jxon");
var fs = require("fs");
var async = require("async");
var request = require("request");

var config = require("./config.js");

// TODO: Set buildings as hidden until confirmed as correct
// TODO: Set buildings as visible using another script when happy
// TODO: Resume uploads after failure, even if script has crashed
// https://github.com/polygon-city/building-database-kml-importer/issues/2

// Check for required settings
if (config) {
  var fail = false;
  if (!config.tags) {
    console.log("Required tags missing");
    fail = true;
  } else {
    if (!config.tags.creator) {
      console.log("Required creator tag missing");
      fail = true;
    }

    if (!config.tags.creatorURL) {
      console.log("Required creator URL tag missing");
      fail = true;
    }

    if (!config.tags.description) {
      console.log("Required description tag missing");
      fail = true;
    }
  }

  if (!config.polygonCity) {
    console.log("Required Polygon City settings missing");
    fail = true;
  } else {
    if (!config.polygonCity.url) {
      console.log("Required Polygon City URL missing");
      fail = true;
    }

    if (!config.polygonCity.user) {
      console.log("Required Polygon City username missing");
      fail = true;
    }

    if (!config.polygonCity.pass) {
      console.log("Required Polygon City password missing");
      fail = true;
    }
  }

  if (!config.kmlDirectory) {
    console.log("Required KML directory setting missing");
    fail = true;
  }

  if (!config.kmlFile) {
    console.log("Required KML file setting missing");
    fail = true;
  }

  if (fail) {
    process.exit(1);
  }
} else {
  console.log("Required config missing");
  process.exit(1);
}

// TODO: Fix ENOENT error where tmp files are deleted before being finished with
// TODO: Fix { error: 'An error occurred during conversion' }

// For storing login session cookie
var cookieJar = request.jar();

// Batch ID for upload
var batchID = (config.batchID) ? config.batchID.toString() : "";

// Buildings to exclude from batch
var batchExclude = [];

var creator = config.tags.creator;
var creatorURL = config.tags.creatorURL;
var method = "automated";
var description = config.tags.description;

var filePrefix = config.kmlDirectory;

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
    url: config.polygonCity.url + "/api/buildings",
    jar: cookieJar,
    formData: formData
  }, function(err, res, body) {
    if (err) {
      // Skip on error
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

    // REMOVED: Location can now be added in the initial building POST request
    // // Add location
    // // TODO: Calculate proper scale and angle
    // var formDataLocation = {
    //   // Leave original scale, assuming units are in metres already
    //   scale: 1,
    //   angle: building.angle,
    //   latitude: building.latitude,
    //   longitude: building.longitude
    // };

    // request({
    //   method: "PUT",
    //   url: config.polygonCity.url + "/api/building/" + savedBuilding.building._id,
    //   jar: cookieJar,
    //   formData: formDataLocation
    // }, function(err, res, body) {
    //   if (err) {
    //     throw err;
    //   }

    //   console.log(body);

    //   // TODO: Only callback if add was a success
    //   setTimeout(function() {
    //     done();
    //   }, 500);
    // });

    done();
  });
}, 10);

// Login to Polygon City
// TODO: Authenticate with something more robust like OAuth
var login = function() {
  return function (cb) {
    process.nextTick(function() {
      request.post({
        url: config.polygonCity.url + "/login",
        jar: cookieJar,
        form: {
          username: config.polygonCity.user,
          password: config.polygonCity.pass
        }
      }, function(err, res, body) {
        if (err) {
          throw err;
        }

        // TODO: Only callback if login was a success
        cb(null, body);
      });
    });
  };
};

var getBatchID = function() {
  return function (cb) {
    process.nextTick(function() {
      request.get({
        url: config.polygonCity.url + "/api/batch/id",
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
};

var getBatch = function() {
  return function (cb) {
    process.nextTick(function() {
      if (!batchID) {
        cb(new Error("Batch ID not found"));
        return;
      }

      request.get({
        url: config.polygonCity.url + "/api/batch/" + batchID,
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

// TODO: Should this be a waterfall instead so the login cookie and batch ID can be passed along?
// TODO: If batch ID is provided on load, check current status and only upload buildings that haven't been added (eg. that aren't returned)
async.series([
  login(),
  (batchID) ? getBatch() : getBatchID(),
  readKML(filePrefix + config.kmlFile)
], function(err, results) {
  if (err) {
    throw err;
  }
});