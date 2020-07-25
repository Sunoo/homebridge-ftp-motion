import {
  API,
  APIEvent,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig
} from 'homebridge';
import { FtpSrv } from 'ftp-srv';
import ip from 'ip';
import Bunyan from 'bunyan';
import Stream from 'stream';
import { MotionFS } from './motionfs';

const PLUGIN_NAME = 'homebridge-ftp-motion';
const PLATFORM_NAME = 'ftpMotion';

class FtpMotionPlatform implements DynamicPlatformPlugin {
  private readonly log: Logging;
  private readonly config: PlatformConfig;
  private readonly cameraConfigs: Array<any> = [];

  constructor(log: Logging, config: PlatformConfig, api: API) {
    this.log = log;
    this.config = config;

    this.cameraConfigs = [];

    config.cameras.forEach((camera: any) => {
      const ascii = /^[\p{ASCII}]*$/u.test(camera.name);
      if (ascii) {
        this.cameraConfigs.push(camera);
      } else {
        this.log.warn('Camera "' + camera.name + '" contains non-ASCII characters. FTP does not support Unicode, ' +
            'so it is being skipped. Please rename this camera if you wish to use this plugin with it.');
      }
    });

    api.on(APIEvent.DID_FINISH_LAUNCHING, this.startFtp.bind(this));
  }

  configureAccessory(accessory: PlatformAccessory): void { // eslint-disable-line @typescript-eslint/no-unused-vars
    return;
  }

  startFtp(): void {
    const ipAddr = ip.address('public', 'ipv4');
    const ftpPort = this.config.ftp_port || 5000;
    const httpPort = this.config.http_port || 8080;
    const logStream = new Stream.Writable({
      write: (chunk: string, encoding: BufferEncoding, callback): void => {
        const data = JSON.parse(chunk);
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
        callback();
      }
    });
    const bunyanLog = Bunyan.createLogger({
      name: 'ftp',
      streams: [{
        stream: logStream
      }]
    });
    const ftpServer = new FtpSrv({
      url: 'ftp://' + ipAddr + ':' + ftpPort,
      pasv_url: ipAddr,
      anonymous: true,
      blacklist: ['MKD', 'APPE', 'RETR', 'DELE', 'RNFR', 'RNTO', 'RMD'],
      log: bunyanLog
    });
    ftpServer.on('login', (data, resolve) => {
      resolve({fs: new MotionFS(data.connection, this.log, httpPort, this.cameraConfigs), cwd: '/'});
    });
    ftpServer.listen()
      .then(() =>  {
        this.log('FTP server started on port ' + ftpPort + '.');
      });
  }
}

export = (api: API): void => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, FtpMotionPlatform);
};
