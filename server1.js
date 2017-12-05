// Works for 1 tile
var express = require('express');
var proxy = require('proxy-agent');
var fs = require('fs');
var MBTiles = require('@mapbox/mbtiles');
var app = express();
var LRU = require("lru-cache")
  , options = { max: 100000
  , length: function (key, n) { return fs.statSync(key)['size']/1000000.0}
  , dispose: function (key, n) { console.log('dispose',n,fs.statSync(n)); /*fs.statSync(n) &&*/ fs.unlink(n,function(err){if(err){console.log(err);}});  }
  , maxAge: 1000 * 3} // 1 Hour
  , cache = LRU(options);

var AWS = require('aws-sdk');
if (process.argv.length < 4) {
  console.log(" Error! Missing AWS Credentials.\n accessKeyId & secretAccessKey required");
  process.exit(1);
}
// FETCH AWS CREDENTIALS FROM args
accessKeyId = process.argv[2];
secretAccessKey = process.argv[3];
AWS.config.update({
	accessKeyId: accessKeyId,
	secretAccessKey: secretAccessKey,
	region: "ap-southeast-2"
	});
var s3 = new AWS.S3({
	sslEnabled: false,
	httpOptions: {
	agent: new proxy('http://srv-bx-proxyy:3128')
  }});

var port = 3000;
var blankTile = fs.readFileSync("./lib/blankTile.png");
var noDataTile = fs.readFileSync("./lib/noDataTile.png");
// GET PNG FROM Z, X, Y
app.get('/:z/:x/:y.*', function(req, res){
	function zeroPad(num, numZeros) {
		var zeros = Math.max(0, numZeros - num.toString().length);
		var zeroString = Math.pow(10, zeros).toString().substr(1);
		return zeroString + num;
	}
	// CREATE MBTILE FILE NAMES USING Z, X, Y
	var level = req.param('z');
	var col = req.param('x');
	var row = req.param('y');
	console.log('Level - ' + level + ' Col - ' + col + ' row - ' + row);
	var colVal = (parseInt(col / 128)) * 128;
	var rowVal = (parseInt(row / 128)) * 128;
	var colName = zeroPad(colVal.toString(16), 4);
	var rowName = zeroPad(rowVal.toString(16), 4);
	var level = zeroPad(level.toString(10), 2);
	mbtfile = '/R' + rowName + 'C' + colName;
  console.log(mbtfile);
	var temp = '/home/ubuntu/mbtcache' + '/L' + level; // TEMP FOLDER CREATED FOR CACHE IN EC2, MODIFY (/home/ubuntu/mbtcache) PATH WHERE LEVELS EXISTS
	var tempFile = temp + mbtfile + '.mbtiles';
  // IF FILE EXISTS IN CACHE FOLDER & SIZE NOT 0, CACHE IT AND FETCH PNG TILE. ELSE COPY IT FROM AWS S3
  console.log("package in cache? ", cache.get(mbtfile));
	if (typeof(cache.get(mbtfile)) != "undefined"){
    getTile(tempFile, function(err, tile){
			res.header("Content-Type", "image/png");
			res.send(err || tile);
		});
    return;
  } else {
    console.log(10);
		// CHECK IF LEVEL DIR EXISTS, IF NOT CREATE ONE
    if (!fs.existsSync(temp)){
			fs.mkdirSync(temp);
		}
		key = 'mapCacheTest/_alllayers' + '/L' + level + mbtfile + '.mbtiles'; // MODIFY mbt, - PATH INSIDE S3 BUCKET TO WHERE LEVELS EXISTS
    var file = require('fs').createWriteStream(tempFile);
    var params = {Bucket: 'cache-test1', Key: key};
    // WAIT FOR FILE TO BE COPIED TO CACHE LOCATION, THEN FETCH TILES
    console.log("about to hit s3", JSON.stringify(params));
    s3.headObject(params, function(err, data){
      if (err){
        console.log("err!");
        if (err.code == 'NotFound') {
          res.header("Content-Type", "image/png")
          res.send(noDataTile);
        } else {
          res.header("Content-Type", "image/png")
          res.send(blankTile);
        }
      }
       else {
         console.log("no err");
         stream = s3.getObject(params).createReadStream().pipe(file);
           console.log("Stream Started");
         stream.on('finish', function(){
           console.log("Stream Finished")
           getTile(tempFile, function(err, tile){
     				res.header("Content-Type", "image/png");
     				res.send(err || tile);
     			});
          console.log(5);
          cache.set(mbtfile, tempFile);
          console.log(6);
     		});
       }
    });

		return;
	}
	// FUNCTION TO GET PNG TILES FROM MBTILES USING @mapbox/mbtiles NPM MODULE
	function getTile(mbtilesLocation){
		new MBTiles(mbtilesLocation, function(err, mbtiles){
			var extension = req.param(0);
			switch (extension) {
				case "png": {
					mbtiles.getTile(level, col, row, function(err, tile, headers){
						if (err) {
              handleError(err);
						} else {
							res.header("Content-Type", "image/png")
							res.send(tile);
						}
					});
					mbtiles.close();
					break;
				}
				case "grid.json": {
					mbtiles.getGrid(req.param('z'), req.param('x'), req.param('y'), function(err, grid, headers){
						if (err) {
							res.status(404).send('Grid rendering error: ' + err + '\n');
						} else {
							res.header("Content-Type", "text/json")
							res.send(grid);
						}
					});
					break;
				}
			}
			err && console.log(err);
		});
	}

  function handleError(err){
    if (err.message == "Tile does not exist"){
      res.header("Content-Type", "image/png")
      res.send(blankTile);
    } else {
      console.log('Cant find tile',level, col, row)
      res.status(404).send('Tile rendering error: ' + err + '\n');
    }
  }

});
// actually create the server
app.listen(port);
console.log('Listening on port ', port);
