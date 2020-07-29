/* eslint-disable @typescript-eslint/no-unused-vars */
import { Logging } from 'homebridge';
import { FileSystem, FtpConnection } from 'ftp-srv';
import { Stream, TransformCallback } from 'stream';
import http from 'http';
import pathjs from 'path';
import fs from 'fs';
import { Client as FtpClient } from 'basic-ftp';
import { Telegram } from 'telegraf';
import { CameraConfig, StorageMethod } from './configTypes';
import { Transform, Writable} from 'stream';

export class MotionFS extends FileSystem {
  private readonly log: Logging;
  private readonly httpPort: number;
  private readonly cameraConfigs: Array<CameraConfig>;
  private readonly timers: Map<string, NodeJS.Timeout> = new Map();
  private readonly telegram?: Telegram;
  private realCwd: string;

  constructor(connection: FtpConnection, log: Logging, httpPort: number, cameraConfigs: Array<CameraConfig>,
    timers: Map<string, NodeJS.Timeout>, telegram?: Telegram) {
    super(connection);
    this.log = log;
    this.httpPort = httpPort;
    this.cameraConfigs = cameraConfigs;
    this.timers = timers;
    this.telegram = telegram;

    this.realCwd = '/';
  }

  get(fileName: string): any { // eslint-disable-line @typescript-eslint/no-explicit-any
    return {
      name: fileName,
      isDirectory: (): boolean => true,
      size: 1,
      atime: new Date(),
      mtime: new Date(),
      ctime: new Date(),
      uid: 0,
      gid: 0
    };
  }

  list(path = '.'): any { // eslint-disable-line @typescript-eslint/no-explicit-any
    path = pathjs.resolve(this.realCwd, path);
    const dirs = [];
    dirs.push(this.get('.'));
    const pathSplit = path.split('/').filter((value: string) => value.length > 0);
    if (pathSplit.length == 0) {
      this.cameraConfigs.forEach((camera: CameraConfig) => {
        dirs.push(this.get(camera.name));
      });
    } else {
      dirs.push(this.get('..'));
    }
    return dirs;
  }

  chdir(path = '.'): any { // eslint-disable-line @typescript-eslint/no-explicit-any
    path = pathjs.resolve(this.realCwd, path);
    const pathSplit = path.split('/').filter((value: string) => value.length > 0);
    if (pathSplit.length == 0) {
      this.realCwd = path;
      return path;
    } else if (pathSplit.length == 1) {
      const camera = this.cameraConfigs.find((camera: CameraConfig) => camera.name == pathSplit[0]);
      if (camera) {
        this.realCwd = path;
        return path;
      }
    }
    this.connection.reply(550, 'No such directory.');
    return this.realCwd;
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  write(fileName: string, {append = false, start = undefined}): any { // eslint-disable-line @typescript-eslint/no-explicit-any
    const path = pathjs.resolve(this.realCwd, fileName);
    fileName = pathjs.basename(path);
    const pathSplit = pathjs.dirname(path).split('/').filter((value: string) => value != '');
    if (pathSplit.length == 1) {
      const camera = this.cameraConfigs.find((camera: CameraConfig) => camera.name == pathSplit[0]);
      if (camera) {
        this.log.debug(camera.name + ' motion detected.');
        if (!this.timers.get(camera.name)) {
          try {
            http.get('http://127.0.0.1:' + this.httpPort + '/motion?' + camera.name);
          } catch (ex) {
            this.log.error(camera.name + ': Error making HTTP call: ' + ex);
          }
        } else {
          this.log.debug('Motion set received, but cooldown running: ' + camera.name);
        }
        if (camera.cooldown > 0) {
          if (this.timers.get(camera.name)) {
            this.log.debug('Cancelling existing cooldown timer: ' + camera.name);
            const timer = this.timers.get(camera.name);
            if (timer) {
              clearTimeout(timer);
            }
          }
          this.log.debug('Cooldown enabled, starting timer: ' + camera.name);
          const timeout = setTimeout(((): void => {
            this.log.debug('Cooldown finished: ' + camera.name);
            try {
              http.get('http://127.0.0.1:' + this.httpPort + '/motion/reset?' + camera.name);
            } catch (ex) {
              this.log.error(camera.name + ': Error making HTTP call: ' + ex);
            }
            this.timers.delete(camera.name);
          }).bind(this), camera.cooldown * 1000);
          this.timers.set(camera.name, timeout);
        }
        return this.storeImage(fileName, camera);
      }
    }
    this.connection.reply(550, 'Permission denied.');
    return this.getNullStream();
  }

  chmod(path: string, mode: string): any { // eslint-disable-line @typescript-eslint/no-explicit-any
    return;
  }

  mkdir(path: string): any { // eslint-disable-line @typescript-eslint/no-explicit-any
    this.connection.reply(550, 'Permission denied.');
    return this.realCwd;
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  read(fileName: string, {start = undefined}): any { // eslint-disable-line @typescript-eslint/no-explicit-any
    this.connection.reply(550, 'Permission denied.');
    return;
  }

  delete(path: string): any { // eslint-disable-line @typescript-eslint/no-explicit-any
    this.connection.reply(550, 'Permission denied.');
    return;
  }

  rename(from: string, to: string): any { // eslint-disable-line @typescript-eslint/no-explicit-any
    this.connection.reply(550, 'Permission denied.');
    return;
  }

  private uploadFtp(fileName: string, camera: CameraConfig): Writable {
    if (camera.server) {
      const transformStream = this.getTransformStream();
      const client = new FtpClient();
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
        const filePath = pathjs.resolve(camera.path, fileName);
        this.log.debug(camera.name + ': Uploading file to ' + filePath);
        return client.uploadFrom(transformStream, fileName);
      }).then(() => {
        this.log.debug(camera.name + ': Uploaded file: ' + fileName);
      }).catch((err: Error) => {
        this.log.error(camera.name + ': Error uploading file: ' + err.message);
      }).finally(() => {
        client.close();
      });
      return transformStream;
    } else {
      this.log.warn(camera.name + ': FTP upload selected by no remote FTP server defined.');
      return this.getNullStream();
    }
  }

  private saveLocal(fileName: string, camera: CameraConfig): Writable {
    if (!camera.local_path) {
      this.log.warn(camera.name + ': Local storage selected by no local path defined.');
      return this.getNullStream();
    } else {
      const filePath = pathjs.resolve(camera.local_path, fileName);
      this.log.debug(camera.name + ': Writing file to ' + filePath);
      const fileStream = fs.createWriteStream(filePath);
      fileStream.on('finish', () => {
        this.log.debug(camera.name + ': Wrote file: ' + fileName);
      });
      fileStream.on('error', (err: Error) => {
        this.log.error(camera.name + ': Error writing file: ' + err.message);
      });
      return fileStream;
    }
  }

  private sendTelegram(fileName: string, camera: CameraConfig): Writable {
    if (!this.telegram) {
      this.log.warn(camera.name + ': Telegram message selected by no bot token defined.');
      return this.getNullStream();
    } else if (!camera.chat_id) {
      this.log.warn(camera.name + ': Telegram message selected by no chat ID defined.');
      return this.getNullStream();
    } else {
      const transformStream = this.getTransformStream();
      this.log.debug(camera.name + ': Sending ' + fileName + ' to chat ' + camera.chat_id + '.');
      const caption = camera.caption ? { caption: fileName } : {};
      this.telegram.sendPhoto(camera.chat_id, { source: transformStream }, caption)
        .then(() => {
          this.log.debug(camera.name + ': Sent file: ' + fileName);
        });
      return transformStream;
    }
  }

  private storeImage(fileName: string, camera: CameraConfig): Writable {
    switch (camera.method) {
      case StorageMethod.FTP:
        return this.uploadFtp(fileName, camera);
      case StorageMethod.Local:
        return this.saveLocal(fileName, camera);
      case StorageMethod.Telegram:
        return this.sendTelegram(fileName, camera);
      default:
        return this.getNullStream();
    }
  }

  private getTransformStream(): Transform {
    return new Stream.Transform({
      transform: (chunk: any, encoding: BufferEncoding, callback: TransformCallback): void => { // eslint-disable-line @typescript-eslint/no-explicit-any
        callback(null, chunk);
      }
    });
  }

  private getNullStream(): Writable {
    return new Stream.Writable({
      write: (chunk: any, encoding: BufferEncoding, callback): void => { // eslint-disable-line @typescript-eslint/no-explicit-any
        callback();
      }
    });
  }
}