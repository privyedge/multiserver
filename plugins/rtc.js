var URL = require('url')
var pull = require('pull-stream/pull')
var toPull = require('stream-to-pull-stream')
var Map = require('pull-stream/throughs/map')
var SignalHub = require('signalhub')
var SimplePeer = require('simple-peer')
var wrtc = require('wrtc')
var cuid = require('cuid')

module.exports = function (opts) {
  opts = opts || {}
  opts.binaryType = (opts.binaryType || 'arraybuffer')

  var uuid = cuid()
  var sbot = opts.server
  var serverOnConnect = undefined

  //var hubs = opts.hubs || ['https://signalhub-hzbibrznqa.now.sh']
  var connectedServerHubs = []
  var connectedServerPeers = []
  var connectedClientHubs = []

  sbot.on("RTC_HUB_ADDED", CreateServerPeer)

  function closeServer(){
    connectedServerHubs
      .filter(hub => !hub.closed)
      .forEach(hub => hub.close())

    connectedClientHubs
      .filter(hub => !hub.closed)
      .forEach(hub => hub.close())

    connectedServerPeers
      .forEach(peer => peer.destroy())
  }

  function CreateServerPeer(hubAddress) {

    if(!serverOnConnect)
      return

    var hub = Hub(hubAddress)
    connectedServerHubs.push(hub)

    var server = new SimplePeer({ wrtc })
    server.uuid = uuid 
    connectedServerPeers.push(server)

    hub.subscribe('signal')
      .on('data', function(data) {
        if(data.from !== server.uuid && data.initiator){
          server.signal(data.data)
        }
      })

    server.on('signal', function(data) {
      var wrapped = Object.assign({}, {from: server.uuid}, {data})
      hub.subscribe(server.uuid)
        .on('data', function(data) {
          server.signal(data) 
        })
      hub.broadcast('signal', wrapped)
    })

    server.on('connect', function() {
      console.log('RTC server connected to an incoming peer');
      var stream = toPull.duplex(server)
      stream.address = 'rtc:'+server.remoteAddress+':'+server.remotePort
      serverOnConnect(stream)
      hubUrl = hub.urls[0] //assumes hubs only have one url
      hub.close()
      hub = Hub(hubUrl)

      CreateServerPeer(hubAddress)
    })


  }

  return {
    name: 'rtc',
    server: function (onConnect) {
      serverOnConnect = onConnect

      return closeServer
    },
    client: function (addr, cb) {
      var hub = Hub(addr.hostname)
      connectedClientHubs.push(hub)
      var client = new SimplePeer({ wrtc, initiator: true })
      client.uuid = uuid

      hub.subscribe('signal')
        .on('data', function(data) {
          if(data.from !== client.uuid && !data.initiator)
            client.signal(data.data)
        })

      client.on('signal', function(data) {
        var wrapped = Object.assign({}, {from: client.uuid, initiator: true}, {data})

        hub.subscribe(client.uuid)
          .on('data', function(data) {
            client.signal(data) 
          })

        hub.broadcast('signal', wrapped)// 1
      })

      client.on('connect', function() {
        console.log('client connected to a remote peer');
        var stream = toPull.duplex(client)
        stream.address = 'rtc:'+client.remoteAddress+':'+client.remotePort
        hub.close()
        cb(null, stream)
      })

      return () => {
        server.destroy() 
        hub.close()
        cb(new Error('multiserver.rtc: aborted'))
      }
    },
    stringify: function () {
      var port
      if(opts.server)
        port = opts.server.address().port
      else
        port = opts.port

      //TODO: ports?
      return URL.format({
        protocol: 'rtc',
        slashes: true,
        hostname: opts.host || 'localhost', //detect ip address
        port: port || 3483
      })
    },
    parse: function (str) {
      var addr = URL.parse(str)
      if(!/^rtc?\:$/.test(addr.protocol)) return null
      return addr
    }
  }
}

function Hub(hub){
  return SignalHub('sbot-rtc', 'https://' + hub)
}

