#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires */

/**
 * this is a modified copy of [vscode-extension-vscode/bin/test](https://github.com/microsoft/vscode-extension-vscode/blob/main/bin/test)
 */

const path = require('path');
const cp = require('child_process');
const fs = require('fs');

const downloadAndUnzipVSCode = require('@vscode/test-electron').downloadAndUnzipVSCode;

var testsFolder;
if (process.env.CODE_TESTS_PATH) {
    testsFolder = resolvePath(process.env.CODE_TESTS_PATH, process.cwd());
} else if (fs.existsSync(path.join(process.cwd(), 'out', 'test'))) {
    testsFolder = path.join(process.cwd(), 'out', 'test'); // TS extension
} else {
    testsFolder = path.join(process.cwd(), 'test'); // JS extension
}

var testsWorkspace = resolvePath(process.env.CODE_TESTS_WORKSPACE, testsFolder);
var extensionsFolder = resolvePath(process.env.CODE_EXTENSIONS_PATH, process.cwd());
var locale = process.env.CODE_LOCALE || 'en';
var userDataDir = resolvePath(process.env.CODE_TESTS_DATA_DIR, undefined);

console.log('### VS Code Extension Test Run ###');
console.log('');
console.log('Current working directory: ' + process.cwd());

function runTests(executablePath) {
    var args = [
        testsWorkspace,
        '--extensionDevelopmentPath=' + extensionsFolder,
        '--extensionTestsPath=' + testsFolder,
        '--locale=' + locale,
        '--log=debug',
    ];

    if (userDataDir) {
        args.push('--user-data-dir=' + userDataDir);
    }

    if (process.env.CODE_DISABLE_EXTENSIONS) {
        args.push('--disable-extensions');
    }

    console.log('Running extension tests: ' + [executablePath, args.join(' ')].join(' '));

    var cmd = cp.spawn(executablePath, args);

    cmd.stdout.on('data', function (data) {
        console.log(data.toString());
    });

    cmd.stderr.on('data', function (data) {
        console.log(data.toString());
    });

    cmd.on('error', function (data) {
        console.log('Failed to execute tests: ' + data.toString());
    });

    cmd.on('close', function (code, signal) {
        console.log('Tests exited with code: ' + code);

        if (code !== 0) {
            console.log('Signal: ' + signal);
            process.exit(code); // propagate exit code to outer runner
        }
    });
}

function resolvePath(optionalPath, defaultPath) {
    return optionalPath && path.resolve(process.cwd(), optionalPath) || defaultPath;
}

function downloadExecutableAndRunTests() {
    downloadAndUnzipVSCode(process.env.CODE_VERSION).then(executablePath => {
        runTests(executablePath)
    }).catch(err => {
        console.error('Failed to run test with error:')
        console.log(err);
        process.exit(1);
    })
}

downloadExecutableAndRunTests()
