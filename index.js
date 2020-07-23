const { FtpSrv, FileSystem } = require('ftp-srv');
const ip = require('ip');
const stream = require('stream');
const http = require('http');
const pathjs = require('path');
const bunyan = require('bunyan');

module.exports = function(homebridge) {
    homebridge.registerPlatform('homebridge-ftp-motion', 'ftpMotion', ftpMotion, true);
}

function ftpMotion(log, config, api) {
    this.log = log;
    this.config = config;
    
    this.cameraConfigs = config.cameras || [];
    this.httpPort = config.http_port || 8080;

    api.on('didFinishLaunching', this.startFtp.bind(this));
}

ftpMotion.prototype.startFtp = function() {
    const ipAddr = ip.address('public', 'ipv4');
    const ftpPort = this.config.ftp_port || 5000;
    const bunLog = bunyan.createLogger({
        name: 'ftp',
        streams: [{ stream: new Logger(this.log), type: 'raw' }]
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
    constructor(connection, motion) {
        super(connection);
        this.motion = motion;
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
            this.motion.cameraConfigs.forEach(camera => {
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
            const camera = this.motion.cameraConfigs.find(camera => camera.name == pathSplit[0]);
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
            const camera = this.motion.cameraConfigs.find(camera => camera.name == pathSplit[0]);
            if (camera) {
                this.motion.log.debug(camera.name + ' Motion Detected!');
                try {
                    http.get('http://127.0.0.1:' + this.motion.httpPort + '/motion?' + camera.name);
                } catch (ex) {
                    this.motion.log.error(camera.name + ': Error making HTTP call: ' + ex);
                }
                var nullStream = stream.Writable({
                    write: (chunk, encoding, done) => {
                        done();
                    }
                });
                return nullStream;
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