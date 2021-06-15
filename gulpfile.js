// node built-ins
var cp = require('child_process');
var exec = require('child_process').exec;
var spawn = require('child_process').spawn;
var fs = require('fs-extra');
var path = require('path');
var os = require('os');
var tsc = require('gulp-typescript');

// build/test script
var admZip = require('adm-zip');
var minimist = require('minimist');
var mocha = require('gulp-mocha');
var Q = require('q');
var semver = require('semver');
var shell = require('shelljs');
var syncRequest = require('sync-request');
var request = require('request');
var xml2js = require('xml2js');

// gulp modules
var del = require('del');
var gts = require('gulp-typescript');
var gulp = require('gulp');
var gutil = require('gulp-util');
var nuget = null;//require('gulp-nuget');
var pkgm = require('./package');
var util = require('./package-utils');
var typescript = require('typescript');
var args   = require('yargs').argv;

// validation
var NPM_MIN_VER = '3.0.0';
var MIN_NODE_VER = '4.0.0';

if (semver.lt(process.versions.node, MIN_NODE_VER)) {
    console.error('requires node >= ' + MIN_NODE_VER + '.  installed: ' + process.versions.node);
    process.exit(1);
}

//
// Options
//
var mopts = {
    string: 'suite',
    boolean: ['perf', 'e2e'],
    default: { suite: '**', perf: false, e2e: false }
};

var options = minimist(process.argv.slice(2), mopts);

//
// Paths
//

var _buildRoot = "_build";
var _packageRoot = "_package";
var _extnBuildRoot = "_build/Extensions/";
var _taskModuleBuildRoot = "_build/TaskModules/";
var sourcePaths = "@(definitions|Extensions)/**/*";
var ExtensionFolder = "Extensions";
var taskModulesSourcePath = "TaskModules/**/*"
var TaskModulesFolder = "TaskModules"
var TaskModulesTestRoot = path.join(_taskModuleBuildRoot, 'powershell', 'Tests');
var TaskModulesTestTemp = path.join(TaskModulesTestRoot, 'Temp');
var _tempPath = path.join(__dirname, '_temp');
var _testRoot = "_build/";
var _testTemp = "_build/Temp";
var nugetPath = "_nuget";
var cultures = ['en-US', 'de-DE', 'es-ES', 'fr-FR', 'it-IT', 'ja-JP', 'ko-KR', 'ru-RU', 'zh-CN', 'zh-TW'];

//-----------------------------------------------------------------------------------------------------------------
// Build Tasks
//-----------------------------------------------------------------------------------------------------------------

function errorHandler(err) {
    process.exit(1);
}

var rootTsconfigPath = './tsconfig.json';

gulp.task("clean", function() {
    return del([_buildRoot, _packageRoot, nugetPath, _taskModuleBuildRoot]);
});

gulp.task("compilePS", gulp.series("clean", function() {

    if(args.testAreaPath === undefined )
    {
        return gulp.src(sourcePaths, { base: "." }).pipe(gulp.dest(_buildRoot));
    }
    else
    {
        var areaPathArgument = args.testAreaPath;
        if(areaPathArgument.length > 0 )
        {
            console.log('Compiling updated modules - ' + areaPathArgument);
            var areaPaths = areaPathArgument.trim().split(',');
            var filter = [];
            for (var n = 0; n < areaPaths.length; n++) {
                filter.push(ExtensionFolder + '/' + areaPaths[n] + '/**/*')
                }

            return gulp.src(filter, { base: "." }).pipe(gulp.dest(_buildRoot));
        }
        else
        {
            console.log('No module is updated with given change-set');
            // Create a _build/Extensions folder which will be empty
            return gulp.src(ExtensionFolder, { base: "." }).pipe(gulp.dest(_buildRoot));
        }
    }
}));

gulp.task("TaskModuleBuild", gulp.series("clean", function() {
    gulp.src(taskModulesSourcePath, { base: "."}).pipe(gulp.dest(_buildRoot));
}));

gulp.task("clean:TaskModuleTest", function(cb) {
    return del([TaskModulesTestRoot], cb);
});

gulp.task('compile:TaskModuleTest', gulp.series('clean:TaskModuleTest', function (cb) {
    var proj = gts.createProject(rootTsconfigPath, { typescript: typescript, declaration: true });
    var testsPath = path.join('TaskModules', 'powershell', 'Tests', '**/*.ts');
    var testsLibPath = path.join('Extensions', 'Common', 'lib', '**/*.ts');

    var tsconfigPath = path.join('TaskModules', 'powershell', 'Tests', 'tsconfig.json');
    if (fs.existsSync(tsconfigPath)) {
        var projLocal = gts.createProject(tsconfigPath, { typescript: typescript });
        var tsLocal = gts(projLocal);

        gulp.src([testsLibPath, 'definitions/*.d.ts'])
            .pipe(proj())
            .on("error", errorHandler)
            .pipe(gulp.dest(path.join(_extnBuildRoot, 'Common', 'lib')));

        return gulp.src([testsPath, 'definitions/*.d.ts'])
            .pipe(tsLocal)
            .on('error', errorHandler)
            .pipe(gulp.dest(TaskModulesTestRoot));
    }
}));

gulp.task('copy:TaskModuleTest', gulp.series('compile:TaskModuleTest', function (cb) {
    gulp.src([path.join('Extensions', 'Common', 'lib', '**/*')])
        .pipe(gulp.dest(path.join(_extnBuildRoot, 'Common', 'lib')));
    return gulp.src([path.join('TaskModules', 'powershell', 'Tests', '**/*')])
        .pipe(gulp.dest(TaskModulesTestRoot));
}));

gulp.task("TaskModuleTest", gulp.series('copy:TaskModuleTest', function() {
    process.env['TASK_TEST_TEMP'] = TaskModulesTestTemp;
    shell.rm('-rf', TaskModulesTestTemp);
    shell.mkdir('-p', TaskModulesTestTemp);

    var testSuitePath = path.join(TaskModulesTestRoot, options.suite + '/L0.js');
    var tfBuild = ('' + process.env['TF_BUILD']).toLowerCase() == 'true'

    gulp.src([testSuitePath])
        .pipe(mocha({ reporter: 'spec', ui: 'bdd', useColors: !tfBuild }));
}));

gulp.task('prepublish:TaskModulePublish', function (done) {
	return del([TaskModulesTestRoot], done);
});

gulp.task('TaskModulePublish', gulp.series('prepublish:TaskModulePublish', function (done) {
    var powershellModulesDirectory = path.join(_taskModuleBuildRoot, 'powershell', '**/*');

    if(options.outputDir){
        var outputModulesDirectory = path.join(options.outputDir, 'ps_modules');
        shell.mkdir('-p', outputModulesDirectory);
        gulp.src(powershellModulesDirectory).pipe(gulp.dest(outputModulesDirectory));
    }
}));

gulp.task("compileNode", gulp.series("compilePS", function(cb){
     try {
        // Cache all externals in the download directory.
        var allExternalsJson = shell.find(path.join(__dirname, 'Extensions'))
            .filter(function (file) {
                return file.match(/(\/|\\)externals\.json$/);
            })
            .concat(path.join(__dirname, 'externals.json'));
        allExternalsJson.forEach(function (externalsJson) {
            // Load the externals.json file.
            console.log('Loading ' + externalsJson);
            var externals = require(externalsJson);

            // Check for NPM externals.
            if (externals.npm) {
                // Walk the dictionary.
                var packageNames = Object.keys(externals.npm);
                packageNames.forEach(function (packageName) {
                    // Cache the NPM package.
                    var packageVersion = externals.npm[packageName];
                    cacheNpmPackage(packageName, packageVersion);
                });
            }

            // external NuGet V2 packages
            if (externals.nugetv2) {
                var nugetPackages = Object.keys(externals.nugetv2);
                nugetPackages.forEach(function (package) {
                    // download and extract the NuGet V2 package
                    var packageVersion = externals.nugetv2[package].version;
                    var packageRepository = externals.nugetv2[package].repository;
                    var copySpecification = externals.nugetv2[package].cp;

                    var packageSource = cacheNuGetV2Package(packageRepository, package, packageVersion);

                    var relativeExternalsPath = path.dirname(externalsJson).replace(new RegExp('/','g'),'\\').replace(path.join(__dirname),'');
                    if(relativeExternalsPath.startsWith('\\')) {
                        relativeExternalsPath = relativeExternalsPath.substring(1);
                    }
                    var destPath = path.join(_buildRoot, relativeExternalsPath);

                    // copy specific files
                    if (!!copySpecification) {
                        copyGroups(copySpecification, packageSource, destPath);
                    }
                });
            }

            // Check for archive files.
            if (externals.archivePackages) {
                // Walk the array.
                externals.archivePackages.forEach(function (archive) {
                    // Cache the archive file.
                    cacheArchiveFile(archive.url);
                });
            }

            // check of task modules
            if(externals.taskModule) {
                var taskModules = Object.keys(externals.taskModule);
                taskModules.forEach(function (moduleIndex) {
                      var module = externals.taskModule[moduleIndex];
                      var srcPath = path.join("TaskModules", module['type'], module['name']);
                      var relativeExternalsPath = path.dirname(externalsJson).replace(new RegExp('/','g'),'\\').replace(path.join(__dirname),'');
                      if(relativeExternalsPath.startsWith('\\')) {
                         relativeExternalsPath = relativeExternalsPath.substring(1);
                      }
                      var destPath = path.join(_buildRoot, relativeExternalsPath, module['dest']);
                      shell.mkdir('-p', destPath);
                      shell.cp('-R', srcPath, destPath);
                });
            }
        });
    }
    catch (err) {
        console.log('error:' + err.message);
        cb(new gutil.PluginError('compileTasks', err.message));
        return;
    }

    // Compile UIExtensions
    fs.readdirSync( path.join(__dirname, 'Extensions/')).filter(function (file) {
        return fs.statSync(path.join(_extnBuildRoot, file)).isDirectory() && file != "Common";
    }).forEach(compileUIExtensions);

    //Foreach task under extensions copy common modules
    fs.readdirSync(_extnBuildRoot).filter(function (file) {
        return fs.statSync(path.join(_extnBuildRoot, file)).isDirectory() && file != "Common";
    }).forEach(copyCommonModules);


    var artifactEnginePath = path.join(__dirname, '_build/Extensions/ArtifactEngine');
    runNpmInstall(artifactEnginePath);

    // Compile tasks
    var proj = gts.createProject(rootTsconfigPath, { typescript: typescript, declaration: true });
    var taskFiles = path.join(__dirname, '_build/Extensions/**/Tasks/**/*.ts');
    var artifactEngineFiles = path.join(__dirname, '_build/Extensions/**/ArtifactEngine/**/*.ts');
    gulp.src(['definitions/*.d.ts', taskFiles, artifactEngineFiles, '!**/node_modules/**', '!**/Extensions/ArtifactEngine/definitions/**'])
        .pipe(proj())
        .pipe(gulp.dest(path.join(_buildRoot, 'Extensions')))
        .on('error', errorHandler);

    // Generate loc files
    createResjson(cb);
    cb();
}));

var copyGroup = function (group, sourceRoot, destRoot) {
    // example structure to copy a single file:
    // {
    //   "source": "foo.dll"
    // }
    //
    // example structure to copy an array of files/folders to a relative directory:
    // {
    //   "source": [
    //     "foo.dll",
    //     "bar",
    //   ],
    //   "dest": "baz/",
    //   "options": "-R"
    // }
    //
    // example to multiply the copy by .NET culture names supported by TFS:
    // {
    //   "source": "<CULTURE_NAME>/foo.dll",
    //   "dest": "<CULTURE_NAME>/"
    // }
    //

    // multiply by culture name (recursive call to self)
    if (group.dest && group.dest.indexOf('<CULTURE_NAME>') >= 0) {
        cultureNames.forEach(function (cultureName) {
            // culture names do not contain any JSON-special characters, so this is OK (albeit a hack)
            var localizedGroupJson = JSON.stringify(group).replace(/<CULTURE_NAME>/g, cultureName);
            copyGroup(JSON.parse(localizedGroupJson), sourceRoot, destRoot);
        });

        return;
    }

    // build the source array
    var source = typeof group.source == 'string' ? [group.source] : group.source;
    source = source.map(function (val) { // root the paths
        return path.join(sourceRoot, val);
    });

    // create the destination directory
    var dest = group.dest ? path.join(destRoot, group.dest) : destRoot + '/';
    dest = path.normalize(dest);
    shell.mkdir('-p', dest);

    // copy the files
    if (group.hasOwnProperty('options') && group.options) {
        shell.cp(group.options, source, dest);
    }
    else {
        shell.cp(source, dest);
    }
}

var copyGroups = function (groups, sourceRoot, destRoot) {
    groups.forEach(function (group) {
        copyGroup(group, sourceRoot, destRoot);
    })
}

function createResjson(callback) {
    try {
        var allLibJson = shell.find(path.join(__dirname, 'Extensions'))
            .filter(function (file) {
                return file.match(/(\/|\\)lib\.json$/);
            });

        allLibJson.forEach(function (libJson) {
            console.log('Generating resJson for ' + libJson);

            // create a key->value map of the default strings
            var defaultStrings = {};
            var lib = JSON.parse(fs.readFileSync(libJson));
            if (lib.messages) {
                for (var key of Object.keys(lib.messages)) {
                    // skip resjson-style comments for localizers
                    if (!key || key.match(/^_.+\.comment$/)) {
                        continue;
                    }

                    defaultStrings[`loc.messages.${key}`] = lib.messages[key];
                }
            }

            // create the culture-specific resjson files
            for (var culture of cultures) {
                // initialize the culture-specific strings from the default strings
                var cultureStrings = {};
                for (var key of Object.keys(defaultStrings)) {
                    cultureStrings[key] = defaultStrings[key];
                }

                // load the culture-specific xliff file
                var xliffPath = path.join(path.dirname(libJson), 'xliff', `${culture}.xlf`);
                var stats;
                try {
                    stats = fs.statSync(xliffPath);
                }
                catch (err) {
                    if (err.code != 'ENOENT') {
                        throw err;
                    }
                }

                if (stats) {
                    // parse the culture-specific xliff contents
                    var parser = new xml2js.Parser();
                    var xliff;
                    parser.parseString(
                        fs.readFileSync(xliffPath),
                        function (err, result) {
                            if (err) {
                                throw err;
                            }

                            xliff = result;
                        });

                    // overlay the translated strings
                    for (var unit of xliff.xliff.file[0].body[0]['trans-unit']) {
                        if (unit.target[0].$.state == 'translated' &&
                            defaultStrings.hasOwnProperty(unit.$.id) &&
                            defaultStrings[unit.$.id] == unit.source[0]) {

                            cultureStrings[unit.$.id] = unit.target[0]._;
                        }
                    }
                }

                // write the culture-specific resjson file
                var resjsonPath = path.join(path.dirname(libJson), 'Strings', 'resources.resjson', culture, 'resources.resjson');
                var resjsonContents = JSON.stringify(cultureStrings, null, 2);
                shell.mkdir('-p', path.dirname(resjsonPath));
                fs.writeFileSync(resjsonPath, resjsonContents);
            }
        });
    }
    catch (err) {
        console.log('error:' + err.message);
        callback(new gutil.PluginError('compileTasks', err.message));
        throw err;
    }
}

function handoff(callback) {
    // create a key->value map of default strings and comments for localizers
    //
    // resjson-style resources:
    //   "greeting": "Hello",
    //   "_greeting.comment": "A welcome greeting.",
    //
    // for more details about resjson: https://msdn.microsoft.com/en-us/library/windows/apps/hh465254.aspx

    try {
        var allLibJson = shell.find(path.join(__dirname, 'Extensions'))
            .filter(function (file) {
                return file.match(/(\/|\\)lib\.json$/);
            });

        allLibJson.forEach(function (libJson) {
            console.log('Generating xliff for ' + libJson);


            var defaultStrings = {};
            var comments = {};
            var lib = JSON.parse(fs.readFileSync(libJson));
            if (lib.messages) {
                for (var key of Object.keys(lib.messages)) {
                    if (!key) {
                        throw new Error('key cannot be empty: lib.messages.<key>');
                    }

                    if (key.match(/^_.+\.comment$/)) {
                        var commentKey = key;
                        var valueKey = commentKey.substr(   // trim leading "_"
                            '_'.length,                     // trim trailing ".comment"
                            commentKey.length - '_.comment'.length);
                        comments[`loc.messages.${valueKey}`] = lib.messages[commentKey];
                        continue;
                    }
                    else {
                        defaultStrings[`loc.messages.${key}`] = lib.messages[key];
                    }
                }
            }

            // create or update the culture-specific xlf files
            for (var culture of cultures) {
                if (culture.toUpperCase() == 'EN-US') {
                    continue;
                }

                // test whether xliff file exists
                var xliffPath = path.join(path.dirname(libJson), 'xliff', `${culture}.xlf`);
                var stats;
                try {
                    stats = fs.statSync(xliffPath);
                }
                catch (err) {
                    if (err.code != 'ENOENT') {
                        throw err;
                    }
                }

                var xliff;
                if (stats) {
                    // parse the file
                    var parser = new xml2js.Parser();
                    parser.parseString(
                        fs.readFileSync(xliffPath),
                        function (err, result) {
                            if (err) {
                                throw err;
                            }

                            xliff = result;
                        }
                    )
                }
                else {
                    // create the initial xliff object
                    xliff = {
                        "xliff": {
                            "$": {
                                "version": "1.2"
                            },
                            "file": [
                                {
                                    "$": {
                                        "original": "lib.json",
                                        "source-language": "en-US",
                                        "target-language": culture,
                                        "datatype": "plaintext"
                                    },
                                    "body": [
                                        {
                                            "trans-unit": []
                                        }
                                    ]
                                }
                            ]
                        }
                    }
                }

                // create a map of trans-unit
                var unitMap = {};
                for (var unit of xliff.xliff.file[0].body[0]['trans-unit']) {
                    unitMap[unit['$'].id] = unit;
                }

                for (var key of Object.keys(defaultStrings)) {
                    // add the trans-unit
                    if (!unitMap.hasOwnProperty(key)) {
                        unitMap[key] = {
                            "$": {
                                "id": key
                            },
                            "source": [
                                defaultStrings[key]
                            ],
                            "target": [
                                {
                                    "$": {
                                        "state": "new"
                                    },
                                    "_": ""
                                }
                            ]
                        };
                    }
                    // update the source, target state, and note
                    else if (unitMap[key].source[0] != defaultStrings[key]) {
                        unitMap[key].source = [
                            defaultStrings[key]
                        ];
                        if (unitMap[key].target[0]['$'].state != 'new') {
                            unitMap[key].target[0]['$'].state = "needs-translation";
                        }
                    }

                    // always update the note
                    unitMap[key].note = [
                        (comments[key] || "")
                    ];
                }

                for (var key of Object.keys(unitMap)) {
                    // delete the trans-unit
                    if (!defaultStrings.hasOwnProperty(key)) {
                        delete unitMap[key];
                    }
                }

                // update the body of the xliff object
                xliff.xliff.file[0].body[0]['trans-unit'] = [];
                for (var key of Object.keys(unitMap).sort()) {
                    xliff.xliff.file[0].body[0]['trans-unit'].push(unitMap[key]);
                }

                // write the xliff file
                var options = {
                    "renderOpts": {
                        "pretty": true,
                        "indent": "  ",
                        "newline": os.EOL
                    },
                    "xmldec": {
                        "version": "1.0",
                        "encoding": "utf-8"
                    }
                };

                var builder = new xml2js.Builder(options);
                var xml = builder.buildObject(xliff);
                shell.mkdir('-p', path.dirname(xliffPath));
                fs.writeFileSync(xliffPath, '\ufeff' + xml);
            }
        });
    }
    catch (err) {
        console.log('error:' + err.message);
        callback(new gutil.PluginError('compileTasks', err.message));
        throw err;
    }
}

function runNpmInstall(packagePath) {
    var originalDir = shell.pwd();
    util.cd(packagePath);
    var packageJsonPath = util.rp('package.json');
    if (util.test('-f', packageJsonPath)) {
        util.run('npm install');
    }
    util.cd(originalDir);
}

function compileUIExtensions(extensionRoot) {
    var uiExtensionsPath = path.join(_buildRoot,"Extensions", extensionRoot, 'Src', 'UIExtensions');
    var tsconfigPath = path.join(uiExtensionsPath,"tsconfig.json");
    if (fs.existsSync(tsconfigPath)) {
        var projLocal = gts.createProject(tsconfigPath, { typescript: typescript });
        var tsLocal = gts(projLocal);
        var uiFilePath = path.join(uiExtensionsPath, '**/**/*.ts');
        return gulp.src([uiFilePath])
        .pipe(tsLocal)
        .on('error', errorHandler)
        .pipe(gulp.dest(uiExtensionsPath));
    };
}

gulp.task("build", gulp.series("compileNode"));

gulp.task("handoff", function(cb) {
    handoff(cb);
});

gulp.task("default", gulp.series("build"));

//-----------------------------------------------------------------------------------------------------------------
// Test Tasks
//-----------------------------------------------------------------------------------------------------------------

gulp.task('compileTests', function () {
    var proj = gts.createProject(rootTsconfigPath, { typescript: typescript, declaration: true });
    var testsPath = path.join(__dirname, 'Extensions/**/Tests', '**/*.ts');
    var commonFiles = path.join(__dirname, 'Extensions/**/Common', '**/*.ts')

    return gulp.src([testsPath, commonFiles, 'definitions/*.d.ts'])
        .pipe(proj())
        .pipe(gulp.dest(_testRoot+"\\Extensions"))
        .on('error', errorHandler);
});

gulp.task('testLib', gulp.series('compileTests', function () {
    return gulp.src(['Extensions/Common/lib/**/*'])
        .pipe(gulp.dest(path.join(_testRoot,'Extensions/Common/lib/')));
}));

gulp.task('copyTestData', gulp.series('compileTests', function () {
    return gulp.src(['Extensions/**/Tests/**/data/**'], { dot: true })
        .pipe(gulp.dest(_testRoot+"\\Extensions"));
}));

gulp.task('tstests', gulp.series('compileTests', function () {
    return gulp.src(['Extensions/**/Tests/**/*.ts', 'Extensions/**/Tests/**/*.json', 'Extensions/**/Tests/**/*.js'])
        .pipe(gulp.dest(_testRoot+"\\Extensions"));
}));

gulp.task('ps1tests', gulp.series('compileTests', function () {
    return gulp.src(['Extensions/**/Tests/**/*.ps1', 'Extensions/**/Tests/**/*.json'])
        .pipe(gulp.dest(_testRoot+"\\Extensions"));
}));

gulp.task('testLib_NodeModules', gulp.series('testLib', function () {
    return gulp.src(path.join(__dirname, 'Extensions/Common/lib/vsts-task-lib/**/*'))
        .pipe(gulp.dest(path.join(_testRoot, 'Extensions/Common/lib/node_modules/vsts-task-lib')));
}));

gulp.task('testResources', gulp.parallel('testLib_NodeModules', 'ps1tests', 'tstests', 'copyTestData'));

gulp.task("test", gulp.series("testResources", function(){
    process.env['TASK_TEST_TEMP'] =path.join(__dirname, _testTemp);
    shell.rm('-rf', _testTemp);
    shell.mkdir('-p', _testTemp);

    if (options.suite.indexOf("ArtifactEngine") >= 0  && options.e2e) {
        var suitePath = path.join(_testRoot, "Extensions/" + options.suite + "/**/*e2e.js");
        console.log(suitePath);
        var tfBuild = ('' + process.env['TF_BUILD']).toLowerCase() == 'true'
        return gulp.src([suitePath])
            .pipe(mocha({ reporter: 'spec', ui: 'bdd', useColors: !tfBuild }));
    }

    if (options.suite.indexOf("ArtifactEngine") >= 0  && options.perf) {
        var suitePath = path.join(_testRoot, "Extensions/" + options.suite + "/**/*perf.js");
        console.log(suitePath);
        var tfBuild = ('' + process.env['TF_BUILD']).toLowerCase() == 'true'
        return gulp.src([suitePath])
            .pipe(mocha({ reporter: 'spec', ui: 'bdd', useColors: !tfBuild }));
    }

    var terraformSuitePath = path.join(_testRoot,"Extensions/Terraform/Src/Tasks/TerraformTaskV1/Tests",'/_suite.js');
    console.log(terraformSuitePath);
    var suitePath = path.join(_testRoot,"Extensions/" + options.suite + "/Tests/Tasks", options.suite + '/_suite.js');
    console.log(suitePath);
    var suitePath2 = path.join(_testRoot, "Extensions/" + options.suite + "/**/*Tests.js");
    console.log(suitePath2);
    var tfBuild = ('' + process.env['TF_BUILD']).toLowerCase() == 'true'
    var ignorePath = "!" + path.join(_testRoot, "Extensions",  "/**/UIContribution{,/**}");
    return gulp.src([ terraformSuitePath, suitePath, suitePath2, ignorePath ], { allowEmpty: true })
        .pipe(mocha({ reporter: 'spec', ui: 'bdd', useColors: !tfBuild }));
}));

//-----------------------------------------------------------------------------------------------------------------
// Package//-----------------------------------------------------------------------------------------------------------------

var publisherName = null;
gulp.task("package",  function(cb) {
    if(args.publisher){
        publisherName = args.publisher;
    }

    // use gulp package --extension=<Extension_Name> to package an individual package
    if(args.extension){
        createVsixPackage(args.extension);        return;
    }
    fs.readdirSync(_extnBuildRoot).filter(function (file) {
        return fs.statSync(path.join(_extnBuildRoot, file)).isDirectory() && file != "Common";
    }).forEach(createVsixPackage);
    cb();
});

gulp.task('nuget-download', function(done) {
    console.log("> Checking for nuget.exe");
    if(fs.existsSync('nuget.exe')) {
        return done();
    }
    console.log("> Downloading nuget.exe");
    return request.get('http://nuget.org/nuget.exe')
        .pipe(fs.createWriteStream('nuget.exe'));
});

gulp.task("package_nuget", gulp.series('nuget-download', function() {

    // nuspec
    var version = options.version;
    if (!version) {
        console.error('ERROR: supply version with --version');
        process.exit(1);
    }

    if (!semver.valid(version)) {
        console.error('ERROR: invalid semver version: ' + version);
        process.exit(1);
    }

    if(!options.extension) {
        console.error('ERROR: supply extension name with --extension');
        process.exit(1);
    }

    if(!fs.existsSync("_package\\"+options.extension)) {
        console.error('ERROR: mentioned extension does not exist');
        process.exit(1);
    }
    // Nuget package

    // Copying extension to contents
    var extensionPath = path.join("_package", options.extension);

    shell.rm("-rf", nugetPath);
    var contentsPath = path.join(nugetPath,'pack-source', 'contents');
    shell.mkdir("-p", contentsPath);
    shell.cp(path.join(extensionPath,"*"), contentsPath);

    // nuspec
    var pkgName = 'Mseng.MS.TF.RM.Extensions';
    console.log();
    console.log('> Generating .nuspec file');
    var contents = '<?xml version="1.0" encoding="utf-8"?>' + os.EOL;
    contents += '<package xmlns="http://schemas.microsoft.com/packaging/2010/07/nuspec.xsd">' + os.EOL;
    contents += '   <metadata>' + os.EOL;
    contents += '      <id>' + pkgName + '</id>' + os.EOL;
    contents += '      <version>' + version + '</version>' + os.EOL;
    contents += '      <authors>bigbldt</authors>' + os.EOL;
    contents += '      <owners>bigbldt,Microsoft</owners>' + os.EOL;
    contents += '      <requireLicenseAcceptance>false</requireLicenseAcceptance>' + os.EOL;
    contents += '      <description>For VSS internal use only</description>' + os.EOL;
    contents += '      <tags>VSSInternal</tags>' + os.EOL;
    contents += '   </metadata>' + os.EOL;
    contents += '</package>' + os.EOL;
    console.log('> Generated .nuspec file');

    console.log();
    console.log('> Copying extension to package');
    var nuspecPath = path.join(nugetPath, 'pack-source', pkgName + '.nuspec');
    fs.writeFileSync(nuspecPath, contents);
    console.log('> Copied extension to package');

    // package
    console.log();
    console.log('> Beginning package...');
    var nupkgPath = path.join(nugetPath, 'pack-target');
    var exePath = './nuget.exe';
    gulp.src(nuspecPath)
        .pipe(nuget.pack({ nuget: exePath, version: options.version }))
        .pipe(gulp.dest(nupkgPath));
    console.log();
    console.log('> Package Successful');

    if (options.server) {
        console.log();
        console.log('> Publishing .nupkg file to server');
        gulp.src(path.join(nupkgPath, pkgName + "." + options.version + ".nupkg"))
            .pipe(nuget.push({ source: options.server, nuget: exePath, apiKey: 'SkyRise' }));
        console.log('> Publish Successful');
    }
}));


gulp.task("locCommon",function(){
    return gulp.src(path.join(__dirname, 'Extensions/Common/**/module.json'))
             .pipe(pkgm.LocCommon());
});

var copyCommonModules = function(extensionName) {
    var commonDeps = require('./common.json');
    var commonSrc = path.join(__dirname, 'Extensions/Common');
    var currentExtnRoot = path.join(__dirname, "_build/Extensions" ,extensionName);
    return gulp.src(path.join(currentExtnRoot, '**/task.json'))
        .pipe(pkgm.copyCommonModules(currentExtnRoot, commonDeps, commonSrc));
}

var createVsixPackage = function(extensionName) {
    var extnOutputPath = path.join(_packageRoot, extensionName);
    var extnManifestPath = path.join(_extnBuildRoot, extensionName, "Src");

    if(fs.existsSync(extnManifestPath)) {
      del(extnOutputPath);
      if (publisherName){
          var manifest = JSON.parse(fs.readFileSync(path.join(extnManifestPath,"vss-extension.json")));
          manifest.publisher = publisherName;
          fs.writeFileSync(path.join(extnManifestPath,"vss-extension.json"), JSON.stringify(manifest));
      }
      shell.mkdir("-p", extnOutputPath);
      var packagingCmd = "tfx extension create --manifest-globs vss-extension.json --root " + extnManifestPath + " --output-path " + extnOutputPath;
      executeCommand(packagingCmd, function() {});
    }
}

var executeCommand = function(cmd, callback) {
    shell.exec(cmd, {silent: true}, function(code, output) {
       if(code != 0) {
           console.error("command failed: " + cmd + "\nManually execute to debug");
       }
       else {
           callback();
       }
    });
}

var cacheArchiveFile = function (url) {
    // Validate the parameters.
    if (!url) {
        throw new Error('Parameter "url" cannot be null or empty.');
    }

    // Short-circuit if already downloaded.
    var scrubbedUrl = url.replace(/[/\:?]/g, '_');
    var targetPath = path.join(_tempPath, 'archive', scrubbedUrl);
    if (shell.test('-d', targetPath)) {
        console.log('Archive file already cached: ' + url);
        return targetPath;
    }

    console.log('Downloading archive file: ' + url);

    // Delete any previous partial attempt.
    var partialPath = path.join(_tempPath, 'partial', 'archive', scrubbedUrl);
    if (shell.test('-d', partialPath)) {
        shell.rm('-rf', partialPath);
    }

    // Download the archive file.
    shell.mkdir('-p', partialPath);
    var file = path.join(partialPath, 'file.zip');
    var result = syncRequest('GET', url);
    fs.writeFileSync(file, result.getBody());

    // Extract the archive file.
    console.log("Extracting archive.");
    var directory = path.join(partialPath, "dir");
    var zip = new admZip(file);
    zip.extractAllTo(directory);

    // Move the extracted directory.
    shell.mkdir('-p', path.dirname(targetPath));
    shell.mv(directory, targetPath);

    // Remove the remaining partial directory.
    shell.rm('-rf', partialPath);

    return targetPath;
}

var cacheNpmPackage = function (name, version) {
    // Validate the parameters.
    if (!name) {
        throw new Error('Parameter "name" cannot be null or empty.');
    }

    if (!version) {
        throw new Error('Parameter "version" cannot be null or empty.');
    }

    // Short-circuit if already downloaded.
    gutil.log('Downloading npm package ' + name + '@' + version);
    var targetPath = path.join(_tempPath, 'npm', name, version);
    if (shell.test('-d', targetPath)) {
        console.log('Package already cached. Skipping.');
        return;
    }

    // Delete any previous partial attempt.
    var partialPath = path.join(_tempPath, 'partial', 'npm', name, version);
    if (shell.test('-d', partialPath)) {
        shell.rm('-rf', partialPath);
    }

    // Write a temporary package.json file to npm install warnings.
    //
    // Note, write the file higher up in the directory hierarchy so it is not included
    // when the partial directory is moved into the target location
    shell.mkdir('-p', partialPath);
    var pkg = {
        "name": "temp",
        "version": "1.0.0",
        "description": "temp to avoid warnings",
        "main": "index.js",
        "dependencies": {},
        "devDependencies": {},
        "repository": "http://norepo/but/nowarning",
        "scripts": {
            "test": "echo \"Error: no test specified\" && exit 1"
        },
        "author": "",
        "license": "MIT"
    };
    fs.writeFileSync(
        path.join(_tempPath, 'partial', 'npm', 'package.json'),
        JSON.stringify(pkg, null, 2));

    // Validate npm is in the PATH.
    var npmPath = shell.which('npm');
    if (!npmPath) {
        throw new Error('npm not found.  ensure npm 3 or greater is installed');
    }

    // Validate the version of npm.
    var versionOutput = cp.execSync('"' + npmPath + '" --version');
    var npmVersion = versionOutput.toString().replace(/[\n\r]+/g, '')
    console.log('npm version: "' + npmVersion + '"');
    if (semver.lt(npmVersion, NPM_MIN_VER)) {
        throw new Error('npm version must be at least ' + NPM_MIN_VER + '. Found ' + npmVersion);
    }

    // Make a node_modules directory. Otherwise the modules will be installed in a node_modules
    // directory further up the directory hierarchy.
    shell.mkdir('-p', path.join(partialPath, 'node_modules'));

    // Run npm install.
    shell.pushd(partialPath);
    try {
        var cmdline = '"' + npmPath + '" install ' + name + '@' + version;
        var result = cp.execSync(cmdline);
        gutil.log(result.toString());
        if (result.status > 0) {
            throw new Error('npm failed with exit code ' + result.status);
        }
    }
    finally {
        shell.popd();
    }

    // Move the intermediate directory to the target location.
    shell.mkdir('-p', path.dirname(targetPath));
    shell.mv(partialPath, targetPath);
}

var cacheNuGetV2Package = function (repository, name, version) {
    // Validate the parameters.
    if (!repository) {
        throw new Error('Parameter "repository" cannot be null or empty.');
    }

    if (!name) {
        throw new Error('Parameter "name" cannot be null or empty.');
    }

    if (!version) {
        throw new Error('Parameter "version" cannot be null or empty.');
    }

    // Cache the archive file.
    return cacheArchiveFile(repository.replace(/\/$/, '') + '/package/' + name + '/' + version);
}
