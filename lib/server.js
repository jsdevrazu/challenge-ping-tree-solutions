var URL = require('url')
var http = require('http')
var cuid = require('cuid')
var Corsify = require('corsify')
var sendJson = require('send-data/json')
var ReqLogger = require('req-logger')
var healthPoint = require('healthpoint')
var HttpHashRouter = require('http-hash-router')

var redis = require('./redis')
var version = require('../package.json').version

var router = HttpHashRouter()
var logger = ReqLogger({ version: version })
var health = healthPoint({ version: version }, redis.healthCheck)
var cors = Corsify({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, accept, content-type'
})
const bodyParser = require('body-parser').json()
router.set('/favicon.ico', empty)

module.exports = function createServer () {
  return http.createServer(cors(handler))
}

function handler (req, res) {
  if (req.url === '/health') return health(req, res)

  // create a new target
  if (req.url === '/api/targets' && req.method === 'POST') {
    return router(req, res, null, function () {
      bodyParser(req, res, () => {
        redis.rpush('targets', JSON.stringify(req.body))
      })

      sendJson(req, res, { status: 'success' })
    })
  }

  // Get all the targets
  if (req.url === '/api/targets' && req.method === 'GET') {
    return router(req, res, null, function () {
      redis.lrange('targets', 0, -1, (e, r) => {
        const serializedData = r.map((item) => {
          const parsedData = JSON.parse(item)
          redis.EXISTS(`TR${parsedData.id}`, (e, r) => {
            if (r > 0) {
              redis.INCR(`TR${parsedData.id}`)
            } else {
              redis.set(`TR${parsedData.id}`, 1, 'EX', 60 * 60 * 24)
            }
          })
          return parsedData
        })
        sendJson(req, res, { targets: serializedData })
      })
    })
  }

  // Get one single target with target id
  if (req.url.startsWith('/api/target/') && req.method === 'GET') {
    return router(req, res, null, function () {
      const targetId = req.url.split('/api/target/')[1]
      redis.lrange('targets', 0, -1, (e, r) => {
        const serializedData = r.map((item) => {
          const parsedData = JSON.parse(item)
          return parsedData
        })
        const target = serializedData.filter(
          (item) => parseInt(item.id) === parseInt(targetId)
        )

        if (Object.keys(target[0]).length > 0) {
          redis.EXISTS(`TR${target[0].id}`, (e, r) => {
            if (r > 0) {
              redis.INCR(`TR${target[0].id}`)
            } else {
              redis.set(`TR${target[0].id}`, 1, 'EX', 60 * 60 * 24)
            }
          })
        }
        sendJson(req, res, { ...target[0] })
      })
    })
  }

  // update a target
  if (req.url.startsWith('/api/target/') && req.method === 'POST') {
    return router(req, res, null, function () {
      bodyParser(req, res, () => {
        const targetId = req.url.split('/api/target/')[1]
        redis.lrange('targets', 0, -1, (e, r) => {
          const serializedData = r.map((item) => JSON.parse(item))
          const targetIndex = serializedData.findIndex(
            (item) => parseInt(item.id) === parseInt(targetId)
          )
          if (targetIndex < 0) {
            sendJson(req, res, { status: 'failed' })
          } else {
            redis.lset('targets', targetIndex, JSON.stringify(req.body))
            sendJson(req, res, { status: 'succss' })
          }
        })
      })
    })
  }

  // Get available targets
  if (req.url === '/route' && req.method === 'POST') {
    return router(req, res, null, function () {
      bodyParser(req, res, () => {
        redis.lrange('targets', 0, -1, async (e, r) => {
          const serializedData = r.map((item) => {
            const obj = { ...JSON.parse(item) }

            return obj
          })

          const leftTargets = []
          for (const target of serializedData) {
            const trafficCountPromise = new Promise((resolve, reject) => {
              redis.get('TR' + target.id, (e, r) => {
                if (e) reject(e)
                resolve(r)
              })
            })

            const trafficCount = (await trafficCountPromise) || 0

            if (
              target.accept.geoState.$in.includes(req.body.geoState) &&
               target.accept.hour.$in.includes(
                 new Date(req.body.timestamp).getUTCHours().toString()
               ) &&
               parseInt(trafficCount) < parseInt(target.maxAcceptsPerDay)
            ) {
              leftTargets.push(target)
              redis.EXISTS(`TR${target.id}`, (e, r) => {
                if (r > 0) {
                  redis.INCR(`TR${target.id}`)
                } else {
                  redis.set(`TR${target.id}`, 1, 'EX', 60 * 60 * 24)
                }
              })
            }
          }

          if (leftTargets.length === 0) {
            return sendJson(req, res, { decision: 'reject' })
          }
          sendJson(req, res, {
            targets: leftTargets.sort((a, b) => a.value - b.value)
          })
        })
      })
    })
  }

  req.id = cuid()
  logger(req, res, { requestId: req.id }, function (info) {
    info.authEmail = (req.auth || {}).email
    console.log(info)
  })
  router(req, res, { query: getQuery(req.url) }, onError.bind(null, req, res))
}

function onError (req, res, err) {
  if (!err) return

  res.statusCode = err.statusCode || 500
  logError(req, res, err)

  sendJson(req, res, {
    error: err.message || http.STATUS_CODES[res.statusCode]
  })
}

function logError (req, res, err) {
  if (process.env.NODE_ENV === 'test') return

  var logType = res.statusCode >= 500 ? 'error' : 'warn'

  console[logType](
    {
      err: err,
      requestId: req.id,
      statusCode: res.statusCode
    },
    err.message
  )
}

function empty (req, res) {
  res.writeHead(204)
  res.end()
}

function getQuery (url) {
  return URL.parse(url, true).query // eslint-disable-line
}
