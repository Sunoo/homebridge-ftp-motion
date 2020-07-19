# homebridge-ftp-motion
[![npm](https://img.shields.io/npm/v/homebridge-ftp-motion) ![npm](https://img.shields.io/npm/dt/homebridge-ftp-motion)](https://www.npmjs.com/package/homebridge-ftp-motion)

This plugin converts FTP uploads into HTTP motion alerts [homebridge-camera-ffmpeg](https://github.com/homebridge-plugins/homebridge-camera-ffmpeg) understands.

Note that this plugin itself does not expose any devices to HomeKit.

This is in an extremely early state, and currently only triggers alerts after uploading an image into the folder with the same name as your camera. The image is not currently stored anywhere.

### Installation
1. Install Homebridge using the [official instructions](https://github.com/homebridge/homebridge/wiki).
2. Install homebridge-camera-ffmpeg using `sudo npm install -g homebridge-camera-ffmpeg --unsafe-perm`.
3. Install this plugin using `sudo npm install -g homebridge-dafang-mqtt-republishftp-motion`.
4. Update your configuration file. See configuration sample below.

### Configuration
Edit your `config.json` accordingly. Configuration sample:
 ```
    "platforms": [
        {
            "platform": "ftpMotion",
            "ftp_port": "5000",
            "http_port": 8080,
            "cameras": [
                {
                    "name": "Cat Food Camera",
                }
            ]
        }
    ]
```

| Fields               | Description                                                                             | Required |
|----------------------|-----------------------------------------------------------------------------------------|----------|
| platform             | Must always be `ftpMotion`.                                                             | Yes      |
| ftp_port             | The port to run the FTP server on. (Default: 5000)                                      | No       |
| http_port            | The HTTP port used by homebridge-camera-ffmpeg. (Default: 8080)                         | No       |
| cameras              | Array of Dafang Hacks camera configs (multiple supported).                              | Yes      |
| \|- name             | Name of your camera. (Needs to be the same as in homebridge-camera-ffmpeg config)       | Yes      |
