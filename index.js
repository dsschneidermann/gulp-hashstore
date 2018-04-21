const path = require("path");
const fancylog = require("fancy-log");
const chalk = require("chalk");
const crypto = require("crypto");
const fs = require("fs");

const through = require('through2');
const PluginError = require('plugin-error');

const PLUGIN_NAME = 'gulp-hashstore';

function hashstore(file, { baseDir, invalidateObject, logger } = {}) {
  //process.on('unhandledRejection', r => console.log(r)); // for debugging

  let hashFile = file;
  let log = fancylog;
  if (logger) { log = logger; }

  base = path.normalize('.');
  if (baseDir) { base = baseDir; }

  let invalidateObjectHash;
  if (invalidateObject) {
    if (typeof (invalidateObject) !== "string") {
      invalidateObject = JSON.stringify(invalidateObject);
    }
    invalidateObjectHash = hashFunc(invalidateObject);
  }

  // Clean if invalidation hash is different
  if (invalidateObjectHash && fs.existsSync(hashFile)) {
    try {
      let hashStore = JSON.parse(fs.readFileSync(hashFile));
      if (hashStore.invalidateObjectHash !== invalidateObjectHash) {
        log(PLUGIN_NAME + ': Invalidation triggered, hashes stored will be reset');
        fs.writeFileSync(hashFile, '');
      }
    } catch (err) {
    }
  }

  let stream = through({ objectMode: true, allowHalfOpen: false }, function (file, encoding, callback) {
    $gulp = this;

    if (file.isNull()) {
      return callback(null, file);
    }
    else if (file.isStream()) {
      $gulp.emit('error', new PluginError(PLUGIN_NAME, 'Streams not supported!'));
    }
    else if (file.isBuffer()) {
      let generated_hash = hashFunc(file._contents);
      let hashStore = {};
      if (fs.existsSync(hashFile)) {
        try {
          hashStore = JSON.parse(fs.readFileSync(hashFile));
        } catch (err) {
        }
      }

      if (invalidateObjectHash) {
        hashStore.invalidateObjectHash = invalidateObjectHash;
      }
      hashStore.files = (hashStore.files || Array());

      let foundEntry = hashStore.files.find(x => x.file === getPath(base, file.path));
      if (hashStore.files && foundEntry && foundEntry.generated_hash === generated_hash) {
        log(PLUGIN_NAME + ': ' + chalk.green(getPath(base, file.path)) + ' up-to-date');
        return callback(null);
      }

      log(PLUGIN_NAME + ': ' + chalk.green(getPath(base, file.path)) + ' generated hash');

      // Store to file
      let existingHashIndex = hashStore.files.indexOf(foundEntry);
      if (existingHashIndex != -1) hashStore.files.splice(existingHashIndex, 1);

      hashStore.files.push({ file: getPath(base, file.path), generated_hash: generated_hash });

      ensureDirectoryExistence(hashFile);
      fs.writeFileSync(hashFile, JSON.stringify(hashStore, null, 2));
      callback(null, file);
    }
  });

  return stream;
}

function hashFunc(input) {
  let sha1sum = crypto.createHash('sha1');
  sha1sum.update(input);
  return sha1sum.digest('hex');
}

function getPath(dir, filePath) {
  return path.normalize(path.relative(dir, filePath));
}

function ensureDirectoryExistence(filePath) {
  let dirname = path.dirname(filePath);
  if (fs.existsSync(dirname)) {
    return true;
  }
  ensureDirectoryExistence(dirname);
  fs.mkdirSync(dirname);
}

module.exports = hashstore;
