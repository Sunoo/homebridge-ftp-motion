const { FtpSrv, FileSystem } = require('ftp-srv');
const ip = require('ip');
const stream = require('stream');
const http = require('http');
const pathjs = require('path');
const bunyan = require('bunyan');
const fs = require('fs');
const basicFtp = require("basic-ftp");

module.exports = function(homebridge) {
    homebridge.registerPlatform('homebridge-ftp-motion', 'ftpMotion', ftpMotion, true);
}

function ftpMotion(log, config, api) {
    this.log = log;
    this.config = config;
    
    this.httpPort = config.http_port || 8080;
    this.cameraConfigs = [];

    config.cameras.forEach((camera) => {
        const ascii = /^[\x00-\x7F]*$/.test(camera.name);
        if (ascii) {
            this.cameraConfigs.push(camera);
        } else {
            this.log.warn('Camera "' + camera.name + '" contains non-ASCII characters. FTP does not support Unicode, ' +
            'so it is being skipped. Please rename this camera if you wish to use this plugin with it.');
        }
        this.log(camera.name);
    })

    api.on('didFinishLaunching', this.startFtp.bind(this));
}

ftpMotion.prototype.startFtp = function() {
    const ipAddr = ip.address('public', 'ipv4');
    const ftpPort = this.config.ftp_port || 5000;
    const bunLog = bunyan.createLogger({
        name: 'ftp',
        streams: [{
            stream: new Logger(this.log),
            type: 'raw'
        }]
    });
    const ftpServer = new FtpSrv({
        url: 'ftp://' + ipAddr + ':' + ftpPort,
        pasv_url: ipAddr,
        anonymous: true,
        blacklist: ['MKD', 'APPE', 'RETR', 'DELE', 'RNFR', 'RNTO', 'RMD'],
        log: bunLog
    });
    ftpServer.on('login', (data, resolve) => {
        resolve({fs: new MotionFS(data.connection, this), cwd: '/'});
    })
    ftpServer.listen()
    .then(() =>  {
        this.log('FTP server started on port ' + ftpPort + '.');
    })
}

class Logger {
    constructor(log) {
        this.log = log;
    }

    write(data) {
        const message = 'FTP Server: ' + data.msg;
        if (data.level >= 50) {
            this.log.error(message);
        } else if (data.level >= 40) {
            this.log.warn(message);
        } else if (data.level >= 30) {
            this.log.info(message);
        } else if (data.level >= 20) {
            this.log.debug(message);
        }
    }
}

class MotionFS extends FileSystem {
    constructor(connection, main) {
        super(connection);
        this.main = main;
    }
    
    get(fileName) {
        return {
            name: fileName,
            isDirectory: () => true,
            size: 1,
            atime: new Date(),
            mtime: new Date(),
            ctime: new Date(),
            uid: 0,
            gid: 0
        }
    }

    list(path = '.') {
        path = pathjs.join(this.cwd, path);
        var dirs = [];
        dirs.push(this.get('.'));
        if (this.cwd == '/') {
            this.main.cameraConfigs.forEach(camera => {
                dirs.push(this.get(camera.name));
            });
        } else {
            dirs.push(this.get('..'));
        }
        return dirs;
    }

    chdir(path = '.') {
        path = pathjs.join(this.cwd, path);
        const pathSplit = path.split('/').filter(value => value.length > 0);
        if (pathSplit.length == 0) {
            this.cwd = path;
            return path;
        } else if (pathSplit.length == 1) {
            const camera = this.main.cameraConfigs.find(camera => camera.name == pathSplit[0]);
            if (camera) {
                this.cwd = path;
                return path;
            }
        }
        this.connection.reply(550, 'No such directory.');
        return this.cwd;
    }

    write(fileName, {append = false, start = undefined}) {
        const pathSplit = this.cwd.split('/').filter((value) => value != '');
        if (pathSplit.length == 1) {
            const camera = this.main.cameraConfigs.find(camera => camera.name == pathSplit[0]);
            if (camera) {
                this.main.log.debug(camera.name + ' motion detected.');
                try {
                    http.get('http://127.0.0.1:' + this.main.httpPort + '/motion?' + camera.name);
                } catch (ex) {
                    this.main.log.error(camera.name + ': Error making HTTP call: ' + ex);
                }
                let writeStream;
                if (camera.server) {
                    writeStream = stream.Transform({
                        transform: (chunk, encoding, done) => {
                            done(null, chunk);
                        }
                    });
                    const client = new basicFtp.Client();
                    const remotePort = camera.port || 21;
                    const remotePath = camera.path || '/';
                    client.access({
                        host: camera.server,
                        port: remotePort,
                        user: camera.username,
                        password: camera.password,
                        secure: camera.tls
                    }).then(() => {
                        return client.ensureDir(remotePath);
                    }).then(() => {
                        return client.uploadFrom(writeStream, fileName);
                    }).catch((err) => {
                        this.main.log.error(camera.name + ': Error uploading file: ' + err);
                    }).finally(() => {
                        client.close();
                    });
                } else if (camera.path) {
                    let filePath = pathjs.join(camera.path, fileName);
                    writeStream = fs.createWriteStream(filePath);
                    writeStream.on('finish', () => {
                        this.main.log.debug(camera.name + ': Wrote file: ' + fileName);
                    });
                    writeStream.on('error', (err) => {
                        this.main.log.error(camera.name + ': Error writing file: ' + err);
                    });
                } else {
                    writeStream = stream.Writable({
                        write: (chunk, encoding, done) => {
                            done();
                        }
                    });
                }
                return writeStream;
            }
        }
        this.connection.reply(550, 'Permission denied.');
        writeStream._write = () => {}
        return writeStream;
    }

    chmod(path, mode) {
        return;
    }

    mkdir(path) {
        this.connection.reply(550, 'Permission denied.');
        return this.cwd;
    }

    read(fileName, {start = undefined}) {
        this.connection.reply(550, 'Permission denied.');
        return;
    }

    delete(path) {
        this.connection.reply(550, 'Permission denied.');
        return;
    }

    rename(from, to) {
        this.connection.reply(550, 'Permission denied.');
        return;
    }
}