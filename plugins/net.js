var net
try {
  net = require('net')
} catch (_) {}

var toPull = require('stream-to-pull-stream')
var scopes = require('ssb-scopes')

function toDuplex (str) {
  var stream = toPull.duplex(str)
  stream.address = 'net:'+str.remoteAddress+':'+str.remotePort
  return stream
}

module.exports = function (opts) {
  // FIXME: does this even work anymore?
  opts.allowHalfOpen = opts.allowHalfOpen !== false
  return {
    name: 'net',
    scope: function() { return opts.scope || 'public' },
    server: function (onConnection) {
      var port = opts.port
      var host = opts.host || opts.scope && scopes.host(opts.scope) || 'localhost'
      console.log('Listening on ' + host + ':' + port + ' (multiserver net plugin)')
      var server = net.createServer(opts, function (stream) {
        var addr = stream.address()
        onConnection(toDuplex(stream))
      }).listen(port, host)
      return function (cb) {
        console.log('Closing server on ' + host + ':' + port + ' (multiserver net plugin)')
        server.close(function(err) {
          if (err) console.error(err)
          else console.log('No longer listening on ' + host + ':' + port + ' (multiserver net plugin)')
          if (cb) cb(err) 
        })
      }
    },
    client: function (opts, cb) {
      var addr = 'net:'+opts.host+':'+opts.port
      var started = false
      var stream = net.connect(opts)
        .on('connect', function () {
          if(started) return
          started = true

          cb(null, toDuplex(stream))
        })
        .on('error', function (err) {
          if(started) return
          started = true
          cb(err)
        })

      return function () {
        started = true
        stream.destroy()
        cb(new Error('multiserver.net: aborted'))
      }
    },
    //MUST be net:<host>:<port>
    parse: function (s) {
      if(!net) return null
      var ary = s.split(':')
      if(ary.length < 3) return null
      if('net' !== ary.shift()) return null
      var port = +ary.pop()
      if(isNaN(port)) return null
      return {
        name: 'net',
        host: ary.join(':') || 'localhost',
        port: port
      }
    },
    stringify: function (scope) {
      var host = scope == 'public' && opts.external || opts.host || scope && scopes.host(scope) || 'localhost'
      return ['net', host, opts.port].join(':')
    }
  }
}
