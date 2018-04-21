# gulp-hashstore
Store sha1 hashes for files and filter from pipe

Load with gulp-load-plugins, usage:

```
gulp.src("./images/**/*")
    .pipe(plugins.hashstore("./images-cache/hashstore.json", [options]))
    // ... process files here
    .pipe(gulp.dest("./images-processed"));
```

### Options

```
baseDir: The base directory for using relative paths. Defaults to the current directory.
invalidateObject: A javascript object, array of objects or string to determine if the whole hashstore should be reset.
logger: A logger to replace the default fancy-log.
```
