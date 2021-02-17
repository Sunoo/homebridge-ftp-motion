import { PlatformIdentifier, PlatformName } from 'homebridge';

export type FtpMotionPlatformConfig = {
  platform: PlatformName | PlatformIdentifier;
  name?: string;
  ftp_port?: number;
  bot_token?: string;
  cameras?: Array<CameraConfig>;
};

export type CameraConfig = {
  name?: string;
  cooldown?: number;
  server?: string;
  port?: number;
  username?: string;
  password?: string;
  tls?: boolean;
  path?: string;
  local_path?: string;
  chat_id?: number;
  caption?: boolean;
};
