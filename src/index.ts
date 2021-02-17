import {
  API,
  APIEvent,
  DynamicPlatformPlugin,
  HomebridgeConfig,
  Logging,
  PlatformAccessory,
  PlatformConfig
} from 'homebridge';
import Bunyan from 'bunyan';
import { readFileSync } from 'fs';
import { FtpSrv } from 'ftp-srv';
import { FfmpegPlatformConfig } from 'homebridge-camera-ffmpeg/dist/configTypes';
import ip from 'ip';
import { Logger } from './logger';
import Stream from 'stream';
import { Telegraf, Context } from 'telegraf';
import Telegram from 'telegraf/typings/telegram';
import { CameraConfig, FtpMotionPlatformConfig } from './configTypes';
import { MotionFS } from './motionfs';

const PLUGIN_NAME = 'homebridge-ftp-motion';
const PLATFORM_NAME = 'ftpMotion';

class FtpMotionPlatform implements DynamicPlatformPlugin {
  private readonly log: Logger;
  private readonly api: API;
  private readonly config: FtpMotionPlatformConfig;
  private readonly porthttp?: number;
  private readonly cameraConfigs: Array<CameraConfig> = [];
  private readonly timers: Map<string, NodeJS.Timeout> = new Map();
  private readonly telegram?: Telegram;

  constructor(log: Logging, config: PlatformConfig, api: API) {
    this.log = new Logger(log);
    this.api = api;
    this.config = config as FtpMotionPlatformConfig;

    const fullConfig = JSON.parse(readFileSync(this.api.user.configPath(), 'utf8')) as HomebridgeConfig;
    const ffmpegConfig = fullConfig.platforms.find((config: { platform: string }) => config.platform === 'Camera-ffmpeg') as unknown as FfmpegPlatformConfig;
    if (!ffmpegConfig) {
      this.log.error('The homebridge-camera-ffmpeg plugin must be installed and configured.');
      return;
    } else {
      this.porthttp = ffmpegConfig?.porthttp;
      if (!this.porthttp) {
        this.log.error('You must have "porthttp" configured in the homebridge-camera-ffmpeg plugin.');
        return;
      }
    }

    this.cameraConfigs = [];

    config.cameras.forEach((camera: CameraConfig) => {
      if (!camera.name) {
        this.log.error('One of your cameras has no name configured. This camera will be skipped.');
      } else {
        const ascii = /^[\p{ASCII}]*$/u.test(camera.name);
        if (ascii) {
          this.cameraConfigs.push(camera);
        } else {
          this.log.warn('Camera name contains non-ASCII characters. FTP does not support Unicode, so it is ' +
            'being skipped. Please rename this camera if you wish to use this plugin with it.', camera.name);
        }
      }
    });

    if (this.config.bot_token) {
      const bot = new Telegraf(this.config.bot_token);
      bot.catch((err: unknown, ctx: Context) => {
        this.log.error(ctx.updateType + ' Error: ' + err, 'Telegram');
      });
      bot.start((ctx) => {
        if (ctx.message) {
          const from = ctx.from?.username || 'unknown';
          const message = 'Chat ID for ' + from + ': ' + ctx.message.chat.id;
          ctx.reply(message);
          this.log.debug(message, 'Telegram');
        }
      });
      this.log.info('Connecting to Telegram...', 'Telegram');
      bot.launch();
      this.telegram = bot.telegram;
    }

    api.on(APIEvent.DID_FINISH_LAUNCHING, this.startFtp.bind(this));
  }

  configureAccessory(accessory: PlatformAccessory): void { // eslint-disable-line @typescript-eslint/no-unused-vars
    return;
  }

  startFtp(): void {
    const ipAddr = ip.address('public', 'ipv4');
    const ftpPort = this.config.ftp_port || 5000;
    const httpPort = this.porthttp!;
    const bunyan = Bunyan.createLogger({
      name: 'ftp',
      streams: [{
        stream: new Stream.Writable({
          write: (chunk: string, encoding: BufferEncoding, callback): void => {
            const data = JSON.parse(chunk);
            if (data.level >= 50) {
              this.log.error(data.msg, 'FTP Server] [Bunyan');
            } else if (data.level >= 40) {
              this.log.warn(data.msg, 'FTP Server] [Bunyan');
            } else if (data.level >= 30) {
              this.log.info(data.msg, 'FTP Server] [Bunyan');
            } else if (data.level >= 20) {
              this.log.debug(data.msg, 'FTP Server] [Bunyan');
            }
            callback();
          }
        })
      }]
    });
    const ftpServer = new FtpSrv({
      url: 'ftp://' + ipAddr + ':' + ftpPort,
      pasv_url: ipAddr,
      anonymous: true,
      blacklist: ['MKD', 'APPE', 'RETR', 'DELE', 'RNFR', 'RNTO', 'RMD'],
      log: bunyan
    });
    ftpServer.on('login', (data, resolve) => {
      resolve({fs: new MotionFS(data.connection, this.log, httpPort, this.cameraConfigs, this.timers, this.telegram), cwd: '/'});
    });
    ftpServer.listen()
      .then(() =>  {
        this.log.info('Started on port ' + ftpPort + '.', 'FTP Server');
      });
  }
}

export = (api: API): void => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, FtpMotionPlatform);
};
