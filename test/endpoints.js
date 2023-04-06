process.env.NODE_ENV = 'test'

var test = require('ava')
var servertest = require('servertest')
var bl = require('bl')
var server = require('../lib/server')

const newTarget = {
  id: '123',
  url: 'http://example.com',
  value: 0.5,
  maxAcceptsPerDay: 10,
  accept: {
    geoState: {
      $in: ['ca', 'ny']
    },
    hour: {
      $in: ['13', '14', '15']
    }
  }
}
const options = {
  method: 'POST',
  // url: '/api/targets',
  headers: {
    'Content-Type': 'application/json'
  },
  encoding: 'json',
  body: JSON.stringify(newTarget)
}

test.serial.cb('healthcheck', function (t) {
  var url = '/health'
  servertest(server(), url, { encoding: 'json' }, function (err, res) {
    t.falsy(err, 'no error')

    t.is(res.statusCode, 200, 'correct statusCode')
    t.is(res.body.status, 'OK', 'status is ok')
    t.end()
  })
})

// test.serial.cb('post a target', function (t) {
//   const streamData = servertest(server(), '/api/targets', options)

//   streamData.on('data', (err, res) => {
//     console.log(err)
//     console.log(res)
//     t.falsy(err, 'no error')

//     t.end()
//   })
// })
