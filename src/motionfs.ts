/* eslint-disable @typescript-eslint/no-unused-vars */
import { Client as FtpClient } from 'basic-ftp';
import fs from 'fs';
import { FileSystem, FtpConnection } from 'ftp-srv';
import http from 'http';
import { Logger } from './logger';
import pathjs from 'path';
import { Readable, Stream, Transform, TransformCallback, Writable  } from 'stream';
import Telegram from 'telegraf/typings/telegram';
import { CameraConfig } from './configTypes';

export class MotionFS extends FileSystem {
  private readonly log: Logger;
  private readonly httpPort: number;
  private readonly cameraConfigs: Array<CameraConfig>;
  private readonly timers: Map<string, NodeJS.Timeout> = new Map();
  private readonly telegram?: Telegram;
  private realCwd: string;

  constructor(connection: FtpConnection, log: Logger, httpPort: number, cameraConfigs: Array<CameraConfig>,
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
        dirs.push(this.get(camera.name!));
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
        this.log.debug('Receiving file.', camera.name + '] [' + fileName);
        if (!this.timers.get(camera.name!)) {
          try {
            http.get('http://127.0.0.1:' + this.httpPort + '/motion?' + camera.name);
          } catch (ex) {
            this.log.error('[' + camera.name + '] [' + fileName + '] Error making HTTP call: ' + ex);
          }
        } else {
          this.log.debug('[' + camera.name + '] [' + fileName + '] Motion set received, but cooldown running.');
        }
        if (camera.cooldown && camera.cooldown > 0) {
          if (this.timers.get(camera.name!)) {
            this.log.debug('[' + camera.name + '] [' + fileName + '] Cancelling existing cooldown timer.');
            const timer = this.timers.get(camera.name!);
            if (timer) {
              clearTimeout(timer);
            }
          }
          this.log.debug('[' + camera.name + '] [' + fileName + '] Cooldown enabled, starting timer.');
          const timeout = setTimeout(((): void => {
            this.log.debug('[' + camera.name + '] Cooldown finished.');
            try {
              http.get('http://127.0.0.1:' + this.httpPort + '/motion/reset?' + camera.name);
            } catch (ex) {
              this.log.error('[' + camera.name + '] [' + fileName + '] Error making HTTP call: ' + ex);
            }
            this.timers.delete(camera.name!);
          }).bind(this), camera.cooldown * 1000);
          this.timers.set(camera.name!, timeout);
        }
        return this.storeImage(fileName, camera);
      }
    } else {
      this.connection.reply(550, 'Permission denied.');
      return this.getNullStream();
    }
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

  private uploadFtp(stream: Readable, fileName: string, camera: CameraConfig): void {
    this.log.debug('Connecting to ' + camera.server + '.', camera.name + '] [Remote FTP] [' + fileName);
    const client = new FtpClient();
    client.access({
      host: camera.server,
      port: camera.port || 21,
      user: camera.username,
      password: camera.password,
      secure: camera.tls
    }).then(() => {
      const remotePath = camera.path || '/';
      this.log.debug('Changing directory to ' + remotePath + '.', camera.name + '] [Remote FTP] [' + fileName);
      return client.ensureDir(remotePath);
    }).then(() => {
      this.log.debug('Uploading file.', camera.name + '] [Remote FTP] [' + fileName);
      return client.uploadFrom(stream, fileName);
    }).then(() => {
      this.log.info('Uploaded file.', camera.name + '] [Remote FTP] [' + fileName);
    }).catch((err: Error) => {
      this.log.error('Error uploading file: ' + err.message, camera.name + '] [Remote FTP] [' + fileName);
    }).finally(() => {
      client.close();
    });
  }

  private saveLocal(stream: Readable, fileName: string, camera: CameraConfig): void {
    const filePath = pathjs.resolve(camera.local_path!, fileName);
    this.log.debug('Writing file to ' + filePath + '.', camera.name + '] [Local] [' + fileName);
    const fileStream = fs.createWriteStream(filePath);
    fileStream.on('finish', () => {
      this.log.info('Wrote file.', camera.name + '] [Local] [' + fileName);
    });
    fileStream.on('error', (err: Error) => {
      this.log.error('Error writing file: ' + err.message, camera.name + '] [Local] [' + fileName);
    });
    stream.pipe(fileStream);
  }

  private sendTelegram(stream: Readable, fileName: string, camera: CameraConfig): void {
    if (!this.telegram) {
      this.log.warn('Chat ID configured but no bot token defined. Skipping.', camera.name + '] [Telegram] [' + fileName);
    } else {
      this.log.debug('Sending to chat ' + camera.chat_id + '.', camera.name + '] [Telegram] [' + fileName);
      const caption = camera.caption ? { caption: fileName } : {};
      this.telegram.sendPhoto(camera.chat_id!, { source: stream }, caption)
        .then(() => {
          this.log.info('Sent file.', camera.name + '] [Telegram] [' + fileName);
        });
    }
  }

  private storeImage(fileName: string, camera: CameraConfig): Writable {
    const stream = this.getTransformStream();
    let upload = false;
    if (camera.server) {
      upload = true;
      this.uploadFtp(stream, fileName, camera);
    }
    if (camera.local_path) {
      upload = true;
      this.saveLocal(stream, fileName, camera);
    }
    if (camera.chat_id) {
      upload = true;
      this.sendTelegram(stream, fileName, camera);
    }
    if (upload) {
      return stream;
    } else {
      this.log.debug('No image store options configured. Discarding.', camera.name + '] [' + fileName);
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