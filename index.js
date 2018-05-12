const path = require("path")
const fancylog = require("fancy-log")
const chalk = require("chalk")
const treeify = require("treeify")
const crypto = require("crypto")
const fs = require("fs")

const through = require('through2')
const PluginError = require('plugin-error')

const PLUGIN_NAME = 'gulp-hashstore'

//
// TODO: On init, shall tag all existing entries in file (keep in a const dictionary [file, [in_file, true]])
// While running, shall remove the tags that are seen (from the dict [hashfile, [in_file, false]])
// After running, it is possible to clean up all files that have not been part of results (as flush action?)
// 

const _module_hashStores = {}
const _module_state = {}
const _module_configs = {}
const _module_current_datetime = Date.now()

function sources(file,
  { baseDir, invalidateObject, outputPostfixes = [], logger, verbose = false, logSummary = true, logTree = true, logOnlyChanged = true } = {}) {
  // process.on('unhandledRejection', r => console.log(r)) // for debugging

  let hashFile = file
  if (typeof (hashFile) !== 'string') {
    throw new PluginError(PLUGIN_NAME, "No file given as first parameter!")
  }

  let config = createModuleConfig(hashFile,
    { baseDir, invalidateObject, outputPostfixes, logger, verbose, logSummary, logTree, logOnlyChanged })
  let hashStore = loadModuleStore(hashFile, config)

  let stream = through({ objectMode: true, allowHalfOpen: false }, function (file, encoding, callback) {
    $gulp = this

    if (file.isNull()) {
      return callback(null, file)
    }
    else if (file.isStream()) {
      $gulp.emit('error', new PluginError(PLUGIN_NAME, "Streams not supported!"))
    }
    else if (file.isBuffer()) {

      let log = config.log_print
      let base = config.base
      if (!config.verbose) {
        log = str => { }
      }

      let outputFilesOK = false
      let generated_hash = hashFunc(file._contents)
      let last_changed = _module_current_datetime

      let foundInputFile = hashStore.inputs.find(x => x.file === getPath(base, file.path))
      if (foundInputFile && foundInputFile.generated_hash === generated_hash) {
        // Input file is a match
        last_changed = foundInputFile.last_changed || _module_current_datetime

        // Verify that existing output files are also correct
        outputFilesOK = true
        for (let i = 0, len = (foundInputFile.outputs || Array()).length; i < len; i++) {
          let existing = foundInputFile.outputs[i]
          let result_hash
          if (fs.existsSync(existing.file)) {
            try {
              result_hash = hashFunc(fs.readFileSync(existing.file))
            } catch (err) {
            }
          }

          if (result_hash && existing.generated_hash === result_hash) {
            log(PLUGIN_NAME + ": " + chalk.green(getPath(base, existing.file)) + " up-to-date")
          } else {
            log(PLUGIN_NAME + ": " + chalk.green(getPath(base, existing.file)) + " incorrect")
            outputFilesOK = false
          }
        }
      }

      if (outputFilesOK) {
        // Nothing more to do
        return callback(null)
      }

      log(PLUGIN_NAME + ": " + getPath(base, file.path) + chalk.green(" generated hash"))

      // Create a new entry for the input file
      let inputFileIndex = hashStore.inputs.indexOf(foundInputFile)
      if (inputFileIndex != -1) hashStore.inputs.splice(inputFileIndex, 1)
      hashStore.inputs.push({
        file: getPath(base, file.path),
        generated_hash: generated_hash,
        last_changed: last_changed
      })

      // Add property to stream and add to seen files collection
      file.__gulp_hashstore_source_path = file.path
      _module_state[hashFile].seenFiles.push({ path: file.path })
      callback(null, file)
    }
  }, flushStateGen(hashFile))

  return stream
}

function results(file, { outputPostfixes } = {}) {

  let hashFile = file
  if (typeof (hashFile) !== 'string') {
    throw new PluginError(PLUGIN_NAME, "No file given as first parameter!")
  }

  let config = loadModuleConfig(hashFile, { isOutputTracking: true })
  let hashStore = loadModuleStore(hashFile, config)

  if (hashStore && config) {
    // Allow config overrides for results() - not sure if this is needed or just superflous
    if (outputPostfixes) {
      config.outputPostfixes = outputPostfixes
    }
    outputPostfixes = config.outputPostfixes
  }

  if (outputPostfixes && outputPostfixes.length) {
    outputPostfixes.forEach(str => {
      if (typeof (str) !== 'string') {
        throw new PluginError(PLUGIN_NAME, "outputPostfixes option must be an array of strings but was:\r\n" +
          JSON.stringify(outputPostfixes))
      }
    })
  }

  let stream = through({ objectMode: true, allowHalfOpen: false }, function (file, encoding, callback) {
    $gulp = this

    if (file.isNull()) {
      return callback(null, file)
    }
    else if (file.isStream()) {
      $gulp.emit('error', new PluginError(PLUGIN_NAME, "Streams not supported!"))
    }
    else if (file.isBuffer()) {

      let sourceFile = file.__gulp_hashstore_source_path
      if (!sourceFile) {
        // If we do not have the property, we have to identify the source file by name
        let examinedPath = file.path

        // Reduce file path by config setting
        if (outputPostfixes && outputPostfixes.length) {
          examinedPath = outputPostfixes.map(pattern =>
            path.dirname(file.path) + '/' +
            safeTrim(path.basename(file.path, path.extname(file.path)), pattern) +
            path.extname(file.path))
            // Take shortest path
            .sort().reverse()[0]
        }

        // Determine by longest partial match
        let possibilities = _module_state[hashFile].seenFiles
        possibilities = whereLongerFileName(examinedPath, possibilities)
        possibilities = whereLongestSharedDir(examinedPath, possibilities)
        possibilities = whereLongestSharedFileName(examinedPath, possibilities)
        possibilities = whereShortestFileName(examinedPath, possibilities)

        if (possibilities.length === 0) {
          $gulp.emit('error', new PluginError(PLUGIN_NAME, "Not able to find source for file: " + file.path + " - Are you missing hashstore.sources() in your pipe?"))
        }
        if (possibilities.length !== 1) {
          $gulp.emit('error', new PluginError(PLUGIN_NAME, "Not able to determine single source for file: " + file.path + " - Possibilities were: \r\n" + possibilities.map(x => x.path).join('\r\n')))
        }

        sourceFile = possibilities[0].path
      }

      let log = config.log_print
      let base = config.base
      if (!config.verbose) {
        log = str => { }
      }

      // Get origin source path and find the entry for it
      let foundInputFile = hashStore.inputs.find(x => x.file === getPath(base, sourceFile))
      if (!foundInputFile) {
        $gulp.emit('error', new PluginError(PLUGIN_NAME, "Not able to find input entry for source: " + sourceFile + " - Did this file skip hashstore.sources() in your pipe?"))
      }

      let generated_hash = hashFunc(file._contents)
      log(PLUGIN_NAME + ": " + getPath(base, file.path) + chalk.green(" new output"))

      // Array was cleared when we passed the input file in the pipe
      let last_changed = foundInputFile.last_changed || _module_current_datetime
      foundInputFile.outputs = foundInputFile.outputs || Array()
      foundInputFile.outputs.push({
        file: getPath(base, file.path),
        generated_hash: generated_hash,
        last_changed: last_changed
      })

      callback(null, file)
    }
  }, flushStateGen(hashFile, { isOutputTracking: true }))

  return stream
}

function flushStateGen(hashFile, { isOutputTracking = false } = {}) {
  return function (callback) {
    let config = loadModuleConfig(hashFile, { isOutputTracking })
    let hashStore = loadModuleStore(hashFile, config)

    if (!isOutputTracking && _module_state[hashFile].outputTrackingAttached) {
      // End early if output tracking is attached and this is not it -
      // flush will be called again when output ends
      return callback(null, null)
    }

    saveModuleStore(hashFile, hashStore)

    var formatDate = d => new Date(Date(d)).toLocaleString()
    var colorDate = d => {
      if (d == _module_current_datetime) {
        return str => chalk.green(str)
      }
      return str => chalk.magenta(str)
    }
    let log = config.log_print

    let newInputFiles = hashStore.inputs.filter(x => x.last_changed == _module_current_datetime);

    if (config.logTree) {
      let root = hashStore.inputs
      let description = "updated hashstore"
      if (config.logOnlyChanged) {
        root = newInputFiles
      }
      if (newInputFiles.length == hashStore.inputs) {
        description = "generated hashstore"
      }
      else if (newInputFiles.length == 0) {
        description = "no change to hashstore"
      }

      let filesDisplay = root
        .reduce((map, obj) => {
          map[obj.file] = (obj.outputs || Array())
            .reduce((map2, obj2) => {
              var d = obj2.last_changed;
              map2[obj2.file] = colorDate(d)(formatDate(d))
              return map2
            }, {})
          if (Object.keys(map[obj.file]).length == 0) {
            var d = obj.last_changed;
            map[obj.file] = colorDate(d)(formatDate(d))
          }
          return map
        }, {})

      let tree = treeify.asTree(filesDisplay, true)
      if (tree) {
        log(PLUGIN_NAME + ": " + chalk.white(description) + "\r\n" + chalk.white(hashFile) + "\r\n" + tree)
      }
    }

    if (config.logSummary) {
      let inputFilesCountText = chalk.magenta(hashStore.inputs.length) + " (0 new)"
      if (newInputFiles.length != 0) {
        inputFilesCountText = chalk.green(hashStore.inputs.length + " (" + newInputFiles.length + " new)")
      }

      let inputFilesText = "\r\n\t\tinputs hashed: " + inputFilesCountText
      let outputFilesCount = hashStore.inputs.reduce((count, obj) => {
        return count + (obj.outputs || Array()).length
      }, 0)
      let outputFilesText = ''
      if (outputFilesCount > 0) outputFilesText = "\r\n\t\toutputs hashed: " + chalk.magenta(outputFilesCount)
      log(PLUGIN_NAME + ": " + chalk.white(hashFile) + inputFilesText + outputFilesText)
    }

    callback(null, null)
  }
}

function loadModuleConfig(hashFile, { isOutputTracking = false } = {}) {
  // Update property (sticky to true)
  _module_configs[hashFile].isOutputTracking = _module_configs[hashFile].isOutputTracking || isOutputTracking
  return _module_configs[hashFile]
}

function createModuleConfig(hashFile, config) {
  if (typeof (hashFile) !== 'string') return null

  let log_print = fancylog
  if (config.logger === null) {
    log_print = str => { }
  } else if (config.logger) {
    log_print = config.logger
  }

  base = path.normalize('.')
  if (config.baseDir) { base = config.baseDir }

  let moduleConfig = {
    log_print: log_print,
    base: base,
    outputPostfixes: config.outputPostfixes,
    verbose: config.verbose,
    logSummary: config.logSummary,
    logTree: config.logTree,
    logOnlyChanged: config.logOnlyChanged,
    isOutputTracking: false // default, can change when we discover later
  }

  let invalidateObject = config.invalidateObject
  if (invalidateObject) {
    if (typeof (invalidateObject) !== 'string') {
      // Assign string representation of object
      invalidateObject = JSON.stringify(invalidateObject)
    }
    moduleConfig.invalidateObjectHash = hashFunc(invalidateObject)
  }

  _module_configs[hashFile] = moduleConfig
  return _module_configs[hashFile]
}

function loadModuleStore(hashFile, config) {
  if (typeof (hashFile) !== 'string') return null

  if (!_module_state[hashFile]) {
    _module_state[hashFile] = {
      seenFiles: Array()
    }
  }

  if (!_module_hashStores[hashFile]) {
    let hashStore = {}
    if (fs.existsSync(hashFile)) {
      try {
        _module_hashStores[hashFile] = JSON.parse(fs.readFileSync(hashFile))
      } catch (err) {
        _module_hashStores[hashFile] = {}
      }
    }
    // Explicit assignment in order to remove other top-level properties
    hashStore.version = '0.2.0'
    hashStore.invalidateObjectHash = _module_hashStores[hashFile].invalidateObjectHash
    hashStore.outputTrackingEnabled = _module_hashStores[hashFile].outputTrackingEnabled
    hashStore.inputs = _module_hashStores[hashFile].inputs || Array()

    // Store new object as store
    _module_hashStores[hashFile] = hashStore
  }

  // Clean state at startup if invalidation hash is different
  if (config.invalidateObjectHash) {
    if (_module_hashStores[hashFile].invalidateObjectHash !== config.invalidateObjectHash) {
      if (_module_hashStores[hashFile].invalidateObjectHash) {
        config.log_print(PLUGIN_NAME + ": " + chalk.white(hashFile) + " is reset due to invalidation change")
      }
      _module_hashStores[hashFile].inputs = Array()
      _module_hashStores[hashFile].invalidateObjectHash = config.invalidateObjectHash
    }
  }

  if (config.isOutputTracking) {
    // Set module state that output tracking is attached for the hashFile
    _module_state[hashFile].outputTrackingAttached = true

    // If store was saved last time without output tracking, we have to invalidate the
    // list of input files.
    if (!_module_hashStores[hashFile].outputTrackingEnabled) {
      // Note: This is a blunt instrument that does not allow mixing outputs and non-outputs in
      // the same hashstore. We could do invalidation on per-item basis during streaming, but
      // it would be more moving parts for only supporting a very theoretical use-case.
      config.log_print(PLUGIN_NAME + ": " + chalk.white(hashFile) + " is reset to add results")
      _module_hashStores[hashFile].inputs = Array()
    }
    _module_hashStores[hashFile].outputTrackingEnabled = true
  }

  return _module_hashStores[hashFile]
}

function saveModuleStore(hashFile, hashStore) {
  ensureDirectoryExistence(hashFile)
  fs.writeFileSync(hashFile, JSON.stringify(hashStore, null, 2))
}

function hashFunc(input) {
  let sha1sum = crypto.createHash('sha1')
  sha1sum.update(input)
  return sha1sum.digest('hex')
}

function getPath(dir, filePath) {
  return path.normalize(path.relative(dir, filePath))
}

function ensureDirectoryExistence(filePath) {
  let dirname = path.dirname(filePath)
  if (fs.existsSync(dirname)) {
    return true
  }
  ensureDirectoryExistence(dirname)
  fs.mkdirSync(dirname)
}

function getLongestSharedFileName(array) {
  let sortedFileNames = array.map(value => path.basename(value)).sort()
  let startElement = sortedFileNames[0], endElement = sortedFileNames[sortedFileNames.length - 1]
  let len = startElement.length, i = 0
  while (i < len && startElement.charAt(i) === endElement.charAt(i)) { i++ }
  return startElement.substring(0, i)
}

function getLongestSharedDir(array) {
  let pathParts = array.map(value => path.dirname(value).split('/').reverse())
  for (let j = 0; j < pathParts.length; j++) {
    for (let i = 0; i < array.length - 1; i++) {
      if (pathParts[i][j] !== pathParts[i + 1][j]) {
        return pathParts[0].slice(0, j)
      }
    }
  }
}

function whereLongerFileName(filepath, seenFiles) {
  let len = path.basename(filepath, path.extname(filepath)).length
  return seenFiles.filter(x => len >= path.basename(x.path, path.extname(x.path)).length)
}

function whereLongestSharedDir(filepath, seenFiles) {
  let possibilities = seenFiles.map(x => {
    return {
      seenFile: x,
      matchCount: getLongestSharedDir([filepath, x.path]).length
    }
  })
  let maxMatchCount = Math.max.apply(null, possibilities.map(x => x.matchCount))
  return possibilities.filter(x => x.matchCount === maxMatchCount).map(x => x.seenFile)
}

function whereLongestSharedFileName(filepath, seenFiles) {
  let possibilities = seenFiles.map(x => {
    return {
      seenFile: x,
      lengthCount: getLongestSharedFileName([filepath, x.path]).length
    }
  })
  let maxLengthCount = Math.max.apply(null, possibilities.map(x => x.lengthCount))
  return possibilities.filter(x => x.lengthCount === maxLengthCount).map(x => x.seenFile)
}

function whereShortestFileName(filepath, seenFiles) {
  let possibilities = seenFiles.map(x => {
    return {
      seenFile: x,
      lengthCount: path.basename(x.path, path.extname(x.path)).length
    }
  })
  let minLengthCount = Math.min.apply(null, possibilities.map(x => x.lengthCount))
  return possibilities.filter(x => x.lengthCount === minLengthCount).map(x => x.seenFile)
}

function safeTrim(str, pattern) {
  var result = undefined // default return for invalid string

  if (str && str.length) {
    result = str
    if (pattern && pattern.length) {
      var idx = str.indexOf(pattern)

      if (idx != -1) {
        result = str.substring(0, idx)
      }
    }
  }
  return result
}

module.exports = { sources, results }
