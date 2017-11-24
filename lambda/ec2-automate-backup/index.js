'use strict';

let aws = require('aws-sdk');
let ec2 = new aws.EC2({apiVersion: '2016-11-15'});

let {
  NAME: appName = process.env.AWS_LAMBDA_FUNCTION_NAME,
  BACKUP_METHOD: backupMethod = 'volumes',
  BACKUP_TAG: backupTag,
  BACKUP_VOLUMES: backupVolumes,
  PURGE_SNAPSHOTS: purgeSnapshots = false,
  PURGE_AFTER_DAYS: purgeAfterDays,
} = process.env;

const currentDate = new Date();

purgeAfterDays = parseInt(purgeAfterDays);

if(Number.isInteger(purgeAfterDays)) {
  var purgeDate = new Date(currentDate);
  purgeDate.setDate(purgeDate.getDate() + purgeAfterDays);
  console.log(`Snapshots taken by ${appName} will be eligible for purging after
    the following date: ${purgeDate.toUTCString()}.`);
}

function getVolumesList() {
  if(backupMethod === 'volumes') {
    if(!backupVolumes || backupVolumes.trim().length === 0) {
      console.log(`The "volumes" backup selection method (which is ${appName}'s
        default method of operation or requested by using the BACKUP_METHOD
        environment variable) requires a BACKUP_VOLUMES environment variable
        for operation. Please set BACKUP_VOLUMES environment variable to
        "vol-12345678", or "vol-12345678, vol-23456789" if multiple volumes
        are to be selected.`);
      process.exit(9);
    }

    var params = {
      VolumeIds: backupVolumes.replace(/\s/g, '').split(',').filter(Boolean),
    };

  } else if(backupMethod === 'tag') {
    if(!backupTag || backupTag.trim().length === 0) {
      console.log(`The backup selection method "tag" requires a valid
        BACKUP_TAG (e.g. Backup=true) specified in environment variable. Please
        set BACKUP_TAG environment variable as follows: "TagName=value".`);
      process.exit(9);
    }

    const [tag, value] = backupTag.split('=');

    params = {
      Filters: [{Name: 'tag:' + tag, Values: [value]}],
    };

  } else {
    console.log(`If you specify a BACKUP_METHOD environment variable for
      selecting EBS volumes you must select either "volumes" or "tag".`);
      process.exit(9);
  }

  return ec2.describeVolumes(params).promise()
    .then(({Volumes}) => (Volumes));
}

function createSnapshots(volumes) {

  return Promise.all(
    volumes.map((volume) => {
      const nameTag = volume.Tags.find(item => item.Key === 'Name');
      const description = `${nameTag.Value || Backup} (${volume.VolumeId}) ` +
        currentDate.toISOString();

      return ec2.createSnapshot({
        VolumeId: volume.VolumeId,
        Description: description,
      }).promise();

    })
  );
}

function createTags(snapshots) {

  return Promise.all(
    snapshots.map((snapshot) => {

      const tags = [
        {Key: 'Name', Value: snapshot.Description},
        {Key: 'CreatedBy', Value: appName},
        {Key: 'Volume', Value: snapshot.VolumeId},
        {Key: 'CreatedOn', Value: currentDate.toISOString()},
      ];

      if(purgeDate) {
        tags.push({Key: 'PurgeAfter', Value: purgeDate.toISOString()})
      }

      return ec2.createTags({
        Resources: [snapshot.SnapshotId],
        Tags: tags,
      }).promise();

    })
  );

}


exports.handler = (event, context, callback) => {

    return getVolumesList()
      .then((volumes) => {
        return createSnapshots(volumes);
      })
      .then((snapshots) => {
        return createTags(snapshots);
      })
      .then(() => {
        if(purgeSnapshots === 'true') {
          return ec2.describeSnapshots({
            Filters: [{Name: 'tag-key', Values: ['PurgeAfter']}]
          }).promise()
            .then(({Snapshots: snapshots}) => {
              snapshots = snapshots.filter((snapshot) => {
                const purgeAfterTag = snapshot.Tags.find(
                  item => item.Key === 'PurgeAfter'
                );
                return new Date(purgeAfterTag.Value) < Date.now();
              });

              console.log('DELETE', snapshots);

              return Promise.all(
                snapshots.map(
                  snapshot => ec2.deleteSnapshot({
                    SnapshotId: snapshot.SnapshotId,
                  }).promise()
                )
              );
            });
        }
      })
      .catch((error) => {
        console.log(error);
        process.exit(1);
      });

};
