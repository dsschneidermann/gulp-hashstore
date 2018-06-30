# gulp-hashstore
Store sha1 hashes for files and filter from pipe.

Usage example (responsive image generation and caching):
```
var hashstore = require('gulp-hashstore');

// Responsive image generation via gulp-responsive - these are the options
config.responsiveOptions = {
  '**/*': [{
    width: 320,
    rename: { suffix: '-320x' }
  }, {
    width: 640,
    rename: { suffix: '-640x' }
  }, {
    width: 1280,
    rename: { suffix: '-1280x' }
  }, {
    width: 1920,
    rename: { suffix: '-1920x' }
  }]
};
  
  // Responsive global options
config.responsiveGlobals = {
  quality: 86,
  progressive: true,
  withMetadata: false,
  withoutEnlargement: false,
  errorOnEnlargement: false,
  errorOnUnusedConfig: false
};
  
// Responsive images
// Generate different sized images for srcset
function imgResponsive() {
  return gulp.src('hugo/static/uploads/**/*.*'))
    .pipe(hashstore.sources('hugo/images-cache/responsiveHashstore.json', // give a filename to store hashes
      {
        invalidateObject: [ config.responsiveOptions, config.responsiveGlobals ], // see options description below
        outputPostfixes: Object.values(config.responsiveOptions).map(
          pattern => pattern.map(item => item.rename.suffix)).flatten()
      }))
    .pipe(plugins.responsive(config.responsiveOptions, config.responsiveGlobals)) // <- this is the image gen. function
    .pipe(gulp.dest('hugo/images-cache/'))
    .pipe(hashstore.results('hugo/images-cache/responsiveHashstore.json')); // give same filename again
```

### Options

```
baseDir: The base directory for using relative paths. Defaults to the current directory.
invalidateObject: A javascript object, array of objects or string to determine if the whole hashstore should be reset. Most useful when you give it the same parameters that your actual pipe function depends on, so invalidation is automatic.
outputPostfixes: An array that contains postfixes that may be added when your pipe function produces output. This is needed in order to always correctly determine which result belongs to which input.
logger: A logger to replace the default fancy-log.
```

See more options in the source code.
