/* eslint-disable @typescript-eslint/no-unused-vars */
import { Logging } from 'homebridge';
import { Client as FtpClient } from 'basic-ftp';
import fs from 'fs';
import { FileSystem, FtpConnection } from 'ftp-srv';
import http from 'http';
import pathjs from 'path';
import { Readable, Stream, Transform, TransformCallback, Writable  } from 'stream';
import { Telegram } from 'telegraf';
import { CameraConfig } from './configTypes';

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
        this.log.debug('[' + camera.name + '] [' + fileName + '] Receiving file.');
        if (!this.timers.get(camera.name)) {
          try {
            http.get('http://127.0.0.1:' + this.httpPort + '/motion?' + camera.name);
          } catch (ex) {
            this.log.error('[' + camera.name + '] [' + fileName + '] Error making HTTP call: ' + ex);
          }
        } else {
          this.log.debug('[' + camera.name + '] [' + fileName + '] Motion set received, but cooldown running.');
        }
        if (camera.cooldown > 0) {
          if (this.timers.get(camera.name)) {
            this.log.debug('[' + camera.name + '] [' + fileName + '] Cancelling existing cooldown timer.');
            const timer = this.timers.get(camera.name);
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
            this.timers.delete(camera.name);
          }).bind(this), camera.cooldown * 1000);
          this.timers.set(camera.name, timeout);
        }
        return this.storeImage(fileName, camera);
      }
    } else {
      this.connection.reply(550, 'Permission denied.');
      return new Stream.Writable({
        write: (chunk: any, encoding: BufferEncoding, callback): void => { // eslint-disable-line @typescript-eslint/no-explicit-any
          callback();
        }
      });
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
    this.log.debug('[' + camera.name + '] [Remote FTP] [' + fileName + '] Connecting to ' + camera.server + '.');
    const client = new FtpClient();
    client.access({
      host: camera.server,
      port: camera.port || 21,
      user: camera.username,
      password: camera.password,
      secure: camera.tls
    }).then(() => {
      const remotePath = camera.path || '/';
      this.log.debug('[' + camera.name + '] [Remote FTP] [' + fileName + '] Changing directory to ' + remotePath + '.');
      return client.ensureDir(remotePath);
    }).then(() => {
      this.log.debug('[' + camera.name + '] [Remote FTP] [' + fileName + '] Uploading file.');
      return client.uploadFrom(stream, fileName);
    }).then(() => {
      this.log.debug('[' + camera.name + '] [Remote FTP] [' + fileName + '] Uploaded file.');
    }).catch((err: Error) => {
      this.log.error('[' + camera.name + '] [Remote FTP] [' + fileName + '] Error uploading file: ' + err.message);
    }).finally(() => {
      client.close();
    });
  }

  private saveLocal(stream: Readable, fileName: string, camera: CameraConfig): void {
    const filePath = pathjs.resolve(camera.local_path, fileName);
    this.log.debug('[' + camera.name + '] [Local] [' + fileName + '] Writing file to ' + filePath + '.');
    const fileStream = fs.createWriteStream(filePath);
    fileStream.on('finish', () => {
      this.log.debug('[' + camera.name + '] [Local] [' + fileName + '] Wrote file.');
    });
    fileStream.on('error', (err: Error) => {
      this.log.error('[' + camera.name + '] [Local] [' + fileName + '] Error writing file: ' + err.message);
    });
    stream.pipe(fileStream);
  }

  private sendTelegram(stream: Readable, fileName: string, camera: CameraConfig): void {
    if (!this.telegram) {
      this.log.warn('[' + camera.name + '] [Telegram] [' + fileName + '] Chat ID configured but no bot token defined. Skipping.');
    } else {
      this.log.debug('[' + camera.name + '] [Telegram] [' + fileName + '] Sending to chat ' + camera.chat_id + '.');
      const caption = camera.caption ? { caption: fileName } : {};
      this.telegram.sendPhoto(camera.chat_id, { source: stream }, caption)
        .then(() => {
          this.log.debug('[' + camera.name + '] [Telegram] [' + fileName + '] Sent file.');
        });
    }
  }

  private storeImage(fileName: string, camera: CameraConfig): Writable {
    const stream = new Stream.Transform({
      transform: (chunk: any, encoding: BufferEncoding, callback: TransformCallback): void => { // eslint-disable-line @typescript-eslint/no-explicit-any
        callback(null, chunk);
      }
    });
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
      this.log.debug('[' + camera.name + '] [' + fileName + '] No image store options configured. Discarding.');
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