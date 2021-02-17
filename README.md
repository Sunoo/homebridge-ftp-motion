# homebridge-ftp-motion

[![npm](https://img.shields.io/npm/v/homebridge-ftp-motion) ![npm](https://img.shields.io/npm/dt/homebridge-ftp-motion)](https://www.npmjs.com/package/homebridge-ftp-motion) [![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)

This plugin converts FTP uploads into HTTP motion alerts [homebridge-camera-ffmpeg](https://github.com/homebridge-plugins/homebridge-camera-ffmpeg) understands.

Note that this plugin itself does not expose any devices to HomeKit.

## Installation

1. Install Homebridge using the [official instructions](https://github.com/homebridge/homebridge/wiki).
2. Install homebridge-camera-ffmpeg using `sudo npm install -g homebridge-camera-ffmpeg --unsafe-perm`.
3. Install this plugin using `sudo npm install -g homebridge-ftp-motion`.
4. Update your configuration file. See configuration sample below.

### Configuration

Edit your `config.json` accordingly. Configuration sample:

 ```json
"platforms": [
    {
        "platform": "ftpMotion",
        "ftp_port": 5000,
        "http_port": 8080,
        "cameras": [
            {
                "name": "Cat Food Camera",
                "path": "/home/user/images/cat"
            }
        ]
    }
]
```

#### Configuration Options

- `ftp_port`: The port to run the FTP server on. (Default: `5000`)
- `bot_token`: The token given by @BotFather when creating the Telegram bot.
- `cameras`: _(Required)_ Array of Dafang Hacks camera configs (multiple supported).
  - `name`: _(Required)_ Name of your camera. (Needs to be the same as in homebridge-camera-ffmpeg config)
  - `cooldown`: Cooldown in seconds. Set to 0 to disable.
  - `server`: Hostname or IP address of the FTP server to upload to. If not set, files will be stored locally.
  - `port`: Port of the remote FTP server. (Default: `21`)
  - `username`: Username of the remote FTP server. If not set, no authentication will be used.
  - `password`: Password of the remote FTP server. If not set, no authentication will be used.
  - `tls`: Should TLS be used to connect to remote FTP server? (Default: `false`)
  - `path`: The location on the remote FTP server to store incoming images.
  - `local_path`: The location on the system Homebridge is running on to store incoming images.
  - `chat_id`: The chat ID given by the bot after sending '/start' to it.
  - `caption`: If true, sends the filename as the caption to the image.

### Camera Configuration

To use this plugin, you'll need to configure the FTP settings on your camera as listed below. Your camera may use slightly different terms for some of these options.

- `Host Name`: The host name or IP address of the computer running Homebridge
- `Port`: The value you used for `ftp_port` in the plugin configuration.
- `Username` and `Password`: Any value can currently be used, as authentication is not currently supported in this plugin. That will likely be added in future versions.
- `Path`: This should be the name of your camera, exactly as defined in the homebridge-camera-ffmpeg plugin.

### Telegram Bot Setup

If you want to use the Telegram functionality of this plugin, you'll need to set up your own Telegram bot. Here are instructions on doing that with this plugin.

- Send `/newbot` to [@BotFather](https://t.me/botfather) on Telegram and answer the questions it asks you.
- When it sends `Use this token to access the HTTP API`, copy the token and add it to this plugin's config under `bot_token`.
- Restart Homebridge, this will allow the bot to start and connect to Telegram.
- If you want the bot to message a group, invite the bot to that group.
- From the chat you want to receive notifications, send `/start`.
- Your bot will send you `Chat ID for (chatname)`, copy that ID to this plugin's config under `chat_id`. This is set uniquely for each camera.
- Restart Homebridge again. Your bot is now configured.
