export type FtpMotionPlatformConfig = {
  name: string;
  ftp_port: number;
  http_port: number;
  cameras: Array<CameraConfig>;
};

export type CameraConfig = {
  name: string;
  cooldown: number;
  server: string;
  port: number;
  username: string;
  password: string;
  tls: boolean;
  path: string;
};