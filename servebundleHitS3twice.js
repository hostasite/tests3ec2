// Serve Bundles from S3 but hits S3 twice
var express = require('express');
var proxy = require('proxy-agent');
var fs = require('fs');
var async = require('async');
var MBTiles = require('@mapbox/mbtiles');
var app = express();

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
var s3 = new AWS.S3();

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
	// CREATE BUNDLE FILE NAMES USING Z, X, Y
	var level = req.param('z');
	var col = req.param('x');
	var row = req.param('y');

	var colVal = (parseInt(col / 128)) * 128;
	var rowVal = (parseInt(row / 128)) * 128;
  var colName = zeroPad(colVal.toString(16), 4);
	var rowName = zeroPad(rowVal.toString(16), 4);
	var levelName = zeroPad(level.toString(10), 2);
  var bundleFile = '/R' + rowName + 'C' + colName;

	// EXTRACT TILE FROM BUNDLE FILE
	getTile(col, row, levelName, bundleFile, function(err, tile){
		res.header("Content-Type", "image/png");
		res.send(err || tile);
	});
	return;

  function getTile(x, y, levelName, bundleFile, callback){
		// BUNDLE FILES & LOCATION FROM S3
    key = 'mapCompactCache/_alllayers' + '/L' + levelName + bundleFile + '.bundle'; // MODIFY .bundle, - PATH INSIDE S3 BUCKET TO WHERE LEVELS EXISTS
    console.log(key);
    var params = {Bucket: 'cache-test1', Key: key};
    bundleOffset = ((y % 128) * 128 + x % 128)*8 + 64;
    var chunks = [];
    var range = bundleOffset+"-"+(bundleOffset+7);
    params.Range = 'bytes=' + range;
    s3.getObject(params,function(err, data){
      if (data == null || data.Body == null){
        res.header("Content-Type", "image/png")
        res.send(noDataTile);
      } else {
        buffer = data.Body;
        imageLength = buffer.readUIntLE(5, 3);
        console.log('imageLength is ' + imageLength);
        if (!imageLength == 0){
          imageOffset = buffer.readUIntLE(0, 5);
          var newRange = imageOffset+"-"+(imageOffset+imageLength);
          params.Range = 'bytes=' + newRange;
          s3.getObject(params,function(err, imgData){
              imgBuffer = imgData.Body;
              callback(null,imgBuffer);
          });
        } else {
          res.header("Content-Type", "image/png")
          res.send(noDataTile);
        }
      }
    });
    return;
  }
});
// Don't listen if being run from somewhere else, the parent will handle that
if (!module.parent) {
	app.listen(port);
	console.log('Listening on', port);
}
module.exports = app;
