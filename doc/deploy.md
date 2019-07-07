# How to Deploy qtuminfo

qtuminfo is splitted into 3 repos:
* [https://github.com/qtumproject/qtuminfo]()
* [https://github.com/qtumproject/qtuminfo-api]()
* [https://github.com/qtumproject/qtuminfo-ui]()

## Prerequisites

* node.js v12.0+
* mysql v8.0+
* redis v5.0+

## Deploy qtum core
1. `git clone --recursive https://github.com/qtumproject/qtum.git --branch=qtuminfo`
2. Follow the instructions of [https://github.com/qtumproject/qtum/blob/master/README.md#building-qtum-core]() to build qtum
3. Run `qtumd` with `-logevents=1` enabled

## Deploy qtuminfo
1. `git clone https://github.com/qtumproject/qtuminfo.git --branch=next`
2. `cd qtuminfo && npm install`
3. Create a mysql database and import [docs/structure.sql](structure.sql)
4. Edit file `qtuminfo-node.json` and change the configurations if needed.
5. `npm run dev`

It is strongly recommended to run `qtuminfo` under a process manager (like `pm2`), to restart the process when `qtuminfo` crashes.

## Deploy qtuminfo-api
1. `git clone https://github.com/qtumproject/qtuminfo-api.git --branch=next`
2. `cd qtuminfo-api && npm install`
3. Create file `config/config.prod.js`, write your configurations into `config/config.prod.js` such as:
    ```javascript
    exports.security = {
        domainWhiteList: ['http://example.com']  // CORS whitelist sites
    }
    // or
    exports.cors = {
        origin: '*'  // Access-Control-Allow-Origin: *
    }

    exports.sequelize = {
        logging: false  // disable sql logging
    }
    ```
    This will override corresponding field in `config/config.default.js` while running.
4. `npm start`

## Deploy qtuminfo-ui
This repo is optional, you may not deploy it if you don't need UI.
1. `git clone https://github.com/qtumproject/qtuminfo-ui.git --branch=next`
2. `cd qtuminfo-ui && npm install`
3. Edit `package.json` for example:
   * Edit `script.build` to `"build": "QTUMINFO_API_BASE_CLIENT=/api/ QTUMINFO_API_BASE_SERVER=http://localhost:3001/ QTUMINFO_API_BASE_WS=//example.com/ nuxt build"` in `package.json` to set the api URL base
   * Edit `script.start` to `"start": "PORT=3000 nuxt start"` to run `qtuminfo-ui` on port 3000
4. `npm run build`
5. `npm start`
