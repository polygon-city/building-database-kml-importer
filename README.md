# Polygon City KML Importer

## Importing a KML file of collada models into Polygon City

* Double-check the collada files are valid and single buildings
  * I usually just open a few in [MeshLab](http://meshlab.sourceforge.net/) as a quick check
* Update the settings in `config.js`
* Run the script using `node index.js`
* Wait for it to finish - it can take a while
* Check the newly added buildings in Polygon City


## Converting CityGML into KML / collada

* [Install Postgis](http://postgis.net/install/)
  * I recommend [Postgres.app on Mac](http://postgresapp.com/)
* [Install 3DCityDB](http://www.3dcitydb.org/3dcitydb/downloads/)
* Create a database to store the CityGML
  * Can be done via a GUI like [pgAdmin](http://www.pgadmin.org/)
  * Or from the commandline with `psql` using `CREATE DATABASE yourcity;`
* Add the Postgis extension to the database
  * Run the following SQL within the new database: `CREATE EXTENSION postgis;`
* [Install the 3DCityDB importer scripts](http://www.3dcitydb.org/3dcitydb/d3dimpexp/)
* Edit the `postgis/CREATE_DB.sh` script installed by the importer
  * This is likely installed at `/Applications/3DCityDB-Importer-Exporter/3dcitydb/postgis/CREATE_DB.sh`
  * Update the database connection details
  * Update reference to the directory where `psql` is found (use `which psql`)
* Make sure `postgis/CREATE_DB.sh` is executable
  * `chmod +x /path/to/postgis/CREATE_DB.sh`
* Run `postgis/CREATE_DB.sh` from the terminal and follow the instructions
  * It's integral that you enter the correct EPSG projection that the CityGML coordinates are in, otherwise exporting will screw up
* Your Postgis database should have a bunch of new tables
* Run the 3DCityDB importer GUI
  * `/Applications/3DCityDB-Importer-Exporter/3DCityDB-Importer-Exporter.sh`
  * If it doesn't open, make it executable using `chmod +x ...`
* Connect to the database
  * Click on the database
  * Enter the connection details
  * If you used `Postgres.app` then the user and pass will be your Mac OS user and pass
  * Click connect and wait for a success message on the right-hand side
* Import the CityGML
  * Click on the import tab
  * Click browse and select the CityGML files (must all be in the same coordinate projection)
  * Select the bottom radio button and ensure all feature classes are selected
  * Click import and wait for it to finish
  * It's normal to see warnings about dodgy geometry and missing textures
* Convert the CityGML to KML / collada
  * Click on the KML / collada export tab
  * Click browser and choose a loation and filename for the exported KMZ
  * Select the bounding box radio button and define the bounds (this can be a bit of a pain)
  * Make sure the reference system is set to WGS 84
  * Set level of detail to highest available
  * Only have COLLADA ticked in the display section
  * Click fetch themes and then select none from the dropdown
  * Only have building selected in the feature classes
  * Click export and wait for it to finish
* Unpack the KMZ
  * Find the KMZ file you just exported
  * Unpack it into its constituent KML and collada files
  * I recommend [The Unarchiver](https://itunes.apple.com/gb/app/the-unarchiver/id425424353?mt=12) for Mac
* Import into Polygon City using the instructions above