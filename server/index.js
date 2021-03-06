const net = require('net')
const http = require('http')
const colors = require('./colors')
const Emit = require('./EventEmit')
const PacketHub = require('./PacketHub3')
const util = require('./util')

const log = util.log

const startServer = (port = 8081) => {
  const packetHub = new PacketHub()

  let tunnelSocket = null
  let serverResponses = {}
  let tunnel = null

  const createConnectionToTunnel = () => {
    if (!!tunnel) {
      return
    }
    tunnel = net.createServer(socket => {
      log(`客户机连接成功!`)
      packetHub.start()
      tunnelSocket = socket
      socket.on('data', (data) => { // 接收到内网主机发来的消息, 内网主机发来的消息是已经包裹完毕的
        packetHub.push(data)
      })
      socket.on('close', () => {
        tunnel.close()
        tunnel = null
        tunnelSocket = null
        packetHub.clear()
        log('客户机断开，3秒后重新开始监听客户机连接')
        setTimeout(() => {
          log('重新开始监听')
          createConnectionToTunnel()
        }, 3000)
      })
    }).listen(9999)
  }

  createConnectionToTunnel()

  const server = http.createServer((request, response) => {
    const method = request.method
    const path = request.url
    const headers = request.headers
    const version = request.httpVersion
    const key = util.generateKey()

    serverResponses[key] = response

    if (method === 'POST') {
      let body = []
      request.on('data', (chunk) => {
        body.push(chunk)
      })
      request.on('end', () => {
        Emit.emit('recvReq', {
          key,
          method,
          version,
          path,
          headers,
          body: Buffer.concat(body),
        })
      })
    } else {
      Emit.emit('recvReq', {
        key,
        method,
        version,
        path,
        headers
      })
    }
  })

  log(`开始监听${port}端口`)
  server.setMaxListeners(5)
  server.listen(port)

  Emit.on('recvReq', ({
    key,
    method,
    version,
    path,
    headers,
    body = ''
  }) => {
    const header = util.generateRequest({
      method,
      version,
      path,
      headers,
      body
    })
    const buf = header
    const packet = util.createWrappedBuf(key, buf)
    if (tunnelSocket) {
      log(`${colors.bgRed(colors.white('Proxy'))} ${colors.bgGreen(colors.black(method))} ${path}`)
      tunnelSocket.write(packet)
    } else {
      serverResponses[key].end('There is no client, please connect client to proxy request!')
    }
  })

  Emit.on('fullpacket', (key, fullPacket) => {
    const {
      body,
      headers,
      status
    } = util.splitResponse(fullPacket)

    if (serverResponses[key]) {
      try {
        serverResponses[key].writeHead(status, headers)
        serverResponses[key].end(body)
      } catch (e) {
        serverResponses[key].end()
        log(e)
      }
      delete serverResponses[key]
    }
  })
}


module.exports = startServer