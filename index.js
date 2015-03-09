var _ = require("lodash");
var JXON = require("jxon");
var fs = require("fs");
var async = require("async");
var request = require("request");

// TODO: Fix ENOENT error where tmp files are deleted before being finished with
// TODO: Fix { error: 'An error occurred during conversion' }

// For storing login session cookie
var cookieJar = request.jar();

var creator = "City of Linz";
var creatorURL = "http://data.linz.gv.at/daten/Geodaten/index.html?ckan_name=3d-geodaten-mit-level-of-detail2";
var method = "automated";
var description = "Part of the automated CityGML dataset released by the City of Linz in 2011.";

var filePrefix = "/Users/Robin/Downloads/a_02_05_Lod2_collada/";

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
    description: building.description
  };

  request.post({
    url: "http://localhost:3000/api/buildings",
    jar: cookieJar,
    formData: formData
  }, function(err, res, body) {
    if (err) {
      throw err;
    }

    var savedBuilding = JSON.parse(body);

    console.log(savedBuilding);

    // Add location
    // TODO: Calculate proper scale and angle
    var formDataLocation = {
      // Forced scale assuming indentical across models (based on metre units)
      scale: 0.6804606524581953,
      angle: building.angle,
      latitude: building.latitude,
      longitude: building.longitude
    };

    request({
      method: "PUT",
      url: "http://localhost:3000/api/building/" + savedBuilding.building._id,
      jar: cookieJar,
      formData: formDataLocation
    }, function(err, res, body) {
      if (err) {
        throw err;
      }

      console.log(body);

      // TODO: Only callback if add was a success
      setTimeout(function() {
        done();
      }, 500);
    });
  });
}, 5);

// Login to Polygon City
// TODO: Authenticate with something more robust like OAuth
var login = function() {
  return function (cb) {
    process.nextTick(function() {
      request.post({
        url: "http://localhost:3000/login",
        jar: cookieJar,
        form: {
          username: "robin",
          password: "123"
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

var readKML = function(path) {
  return function (cb) {
    process.nextTick(function() {
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

          // Add building to queue
          buildingQueue.push(output);
        });
      
        cb(null);
      });
    });
  };
};

async.series([
  login(),
  readKML("/Users/Robin/Downloads/a_02_05_Lod2_collada/doc.kml")
], function(err, results) {
  if (err) {
    throw err;
  }
});