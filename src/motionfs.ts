/* eslint-disable @typescript-eslint/no-unused-vars */
import { Logging } from 'homebridge';
import { FileSystem, FtpConnection } from 'ftp-srv';
import { Stream, TransformCallback } from 'stream';
import http from 'http';
import pathjs from 'path';
import fs from 'fs';
import basicFtp from 'basic-ftp';
import { CameraConfig } from './configTypes';

export class MotionFS extends FileSystem {
  private readonly log: Logging;
  private readonly httpPort: number;
  private readonly cameraConfigs: Array<CameraConfig>;
  private readonly timers: Map<string, NodeJS.Timeout> = new Map();
  private realCwd: string;

  constructor(connection: FtpConnection, log: Logging, httpPort: number,
    cameraConfigs: Array<CameraConfig>, timers: Map<string, NodeJS.Timeout>) {
    super(connection);
    this.log = log;
    this.httpPort = httpPort;
    this.cameraConfigs = cameraConfigs;
    this.timers = timers;

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
        if (camera.server) {
          const transformStream = new Stream.Transform({
            transform: (chunk: any, encoding: BufferEncoding, callback: TransformCallback): void => { // eslint-disable-line @typescript-eslint/no-explicit-any
              callback(null, chunk);
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
            return client.uploadFrom(transformStream, fileName);
          }).catch((err) => {
            this.log.error(camera.name + ': Error uploading file: ' + err);
          }).finally(() => {
            client.close();
          });
        } else if (camera.path) {
          const filePath = pathjs.resolve(camera.path, fileName);
          const fileStream = fs.createWriteStream(filePath);
          fileStream.on('finish', () => {
            this.log.debug(camera.name + ': Wrote file: ' + fileName);
          });
          fileStream.on('error', (err: Error) => {
            this.log.error(camera.name + ': Error writing file: ' + err.message);
          });
        } else {
          return new Stream.Writable({
            write: (chunk: any, encoding: BufferEncoding, callback): void => { // eslint-disable-line @typescript-eslint/no-explicit-any
              callback();
            }
          });
        }
      }
    }
    this.connection.reply(550, 'Permission denied.');
    return new Stream.Writable({
      write: (chunk: any, encoding: BufferEncoding, callback): void => { // eslint-disable-line @typescript-eslint/no-explicit-any
        callback();
      }
    });
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
}