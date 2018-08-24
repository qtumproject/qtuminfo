# How to deploy qtuminfo and qtuminfo-ui

## Prerequisites
* node.js v10.5+
* mongodb v3.6+

## Deploy qtum core
1. `git clone -b explorer/0.15.3 --recursive https://github.com/xuanyan0x7c7/qtum.git`
2. Follow the instructions [https://github.com/qtumproject/qtum#building-qtum-core]() to build qtum
3. Run `qtumd` with `-logevents=1` enabled

## Deploy qtuminfo
1. `git clone https://github.com/qtumproject/qtuminfo.git && cd qtuminfo`
2. `npm install`
3. `mkdir explorer` (you may change the directory name) and write files `package.json` and `qtuminfo-node.json` to it
    ```json
    // package.json
    {
        "name": "explorer-mainnet",
        "private": true,
        "scripts": {
            "start": "qtuminfo-node start"
        },
        "dependencies": {
            "qtuminfo-api": "^0.0.1",
            "qtuminfo-node": "^0.0.1",
            "qtuminfo-ws": "^0.0.1"
        }
    }
    ```
    ```json
    // qtuminfo-node.json
    {
        "chain": "mainnet",
        "port": 3001,
        "datadir": "/absolute/path/to/qtuminfo/packages/explorer/data",
        "services": [
            "qtuminfo-api",
            "qtuminfo-ws",
            "address",
            "balance",
            "block",
            "contract",
            "db",
            "header",
            "mempool",
            "p2p",
            "transaction",
            "web"
        ],
        "servicesConfig": {
            "db": {
            "mongodb": {
                "url": "mongodb://localhost:27017/",
                "database": "qtuminfo-mainnet"
            },
            "rpc": {
                "protocol": "http",
                "host": "localhost",
                "port": 3889,
                "user": "user",
                "password": "password"
            }
            },
            "p2p": {
            "peers": [
                {
                    "ip": {
                        "v4": "127.0.0.1"
                    },
                    "port": 3888
                }
            ]
            },
            "qtuminfo-ws": {
                "port": 3002
            }
        }
    }
    ```
4. `npm run lerna bootstrap`
5. run `npm start` in `packages/explorer` directory

## Deploy qtuminfo-ui
1. `git clone https://github.com/qtumproject/qtuminfo.git && cd qtuminfo`
2. `npm install` \
    You may modify `package.json` as follows:
    * rewrite `script.build` to `"build": "QTUMINFO_API_BASE_CLIENT=/api/ QTUMINFO_API_BASE_SERVER=http://localhost:3001/qtuminfo-api/ QTUMINFO_API_BASE_WS=//example.com/ws/ nuxt build"` in `package.json` to set the api URL base
    * rewrite `script.start` to `"start": "PORT=12345 nuxt start"` to frontend on port 12345
3. `npm run build`
4. `npm start`
