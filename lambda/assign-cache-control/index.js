'use strict';

let cacheControl = 's-maxage=31536000,max-age=172800';

let aws = require('aws-sdk');
let s3 = new aws.S3({apiVersion: '2006-03-01'});

exports.handler = (event, context, callback) => {
  const bucket = event.Records[0].s3.bucket.name;
  const key = decodeURIComponent(event.Records[0].s3.object.key.replace('/+/g', ' '));

  let params = {
    Bucket: bucket,
    Key: key
  };

  s3.getObject(params, (error, data) => {
    if (error) return console.log(error);

    if (!data.CacheControl) {
      let params = {
        Bucket: bucket,
        Key: key,
        CopySource: encodeURIComponent(bucket + '/' + key),
        CacheControl: cacheControl,
        ContentType: data.ContentType,
        MetadataDirective: 'REPLACE'
      };

      s3.copyObject(params, (error, data) => {
        if (error) return console.log(error);
        console.log(`Object: s3://${bucket}/${key}, Cache-Control: ${data.CacheControl}, Content-Type: ${data.ContentType}`);
        console.log('Metadata has been successfully updated.');
      });

    } else {
      console.log(`Object: s3://${bucket}/${key}, Cache-Control: ${data.CacheControl}, Content-Type: ${data.ContentType}`);
      console.log('Cache-Control header is already assigned to this object. Skipping...');
    }

  });
};
