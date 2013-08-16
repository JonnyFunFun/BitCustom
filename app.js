/**
 * Module dependencies.
 */

var express = require('express')
  , routes = require('./routes')
  , connect = require('connect')
  , cookie = require('cookie')
  , path = require('path')
  , http = require('http')
  , redis = require('redis')
  , cluster = require('cluster');

var RedisStore = require('connect-redis')(connect);

var app = express();
var secret = 'some ridiculously long super-secret key thingy';

var sioCookieParser = express.cookieParser(secret);

var redis_store = new RedisStore();

app.configure(function(){
  app.set('port', process.argv[2] || process.env.PORT || 3000);
  app.set('views', __dirname + '/views');
  app.set('view engine', 'ejs');
  app.use(express.favicon(__dirname + '/public/favicon.ico'));
  app.use(express.logger('dev'));
  app.use(express.bodyParser());
  app.use(express.cookieParser());
  app.use(express.session({secret: secret, store: redis_store}));
  app.use(express.static(path.join(__dirname, 'public')));
  app.use(express.methodOverride());
  app.use(app.router);
});

app.configure('development', function(){
  app.use(express.errorHandler());
});

/**
 * Some "constants" 
 */
var VANITYGEN_REGEXP = /\[([\d.]+\s[MK]key\/s)\].*\[Prob\s([\d.]+%)\].*\[(\d+%)\sin\s([\d.]+[ydhms])/;
var VANITYGEN_FINAL_REGEXP = /Address:\s([0-9A-Za-z]+)\nPrivkey:\s([0-9A-Za-z]+)/;
var VANITYGEN_MAX_THREADS = 8;
var MINIMUM_CLUSTER_INSTANCES = 2;

/**
 * Helper functions
 */
String.prototype.f = function() {
    var s = this, i = arguments.length;
    while (i--)
        s = s.replace(new RegExp('\\{' + i + '\\}', 'gm'), arguments[i]);
    return s;
};

/**
 * Application routes
 */

app.get('/', routes.index);
app.post('/check', routes.check);
app.get('/process', routes.process);
app.get('/about', routes.about);
app.get('/contact', routes.contact);
app.post('/contact/send', routes.contact_send);
app.get('/tou', routes.tou);

/**
 * Get it running
 */

var server = http.createServer(app);
server.listen(app.get('port'), function(){
  console.log("Express server listening on port " + app.get('port'));
});

/**
 * Socket.IO stuff
 */

var io     = require('socket.io').listen(server),
	crypto = require('crypto');

io.on('connection', function(socket) {
	sioCookieParser(socket.handshake, {}, function(err) {
		redis_store.get(socket.handshake.signedCookies["connect.sid"], function(err, sessionData) {
			// session data available here
			if (err) {
				socket.emit('error', {msg: "Session error: " + err.toString()});
			} else {
			    if (!sessionData.desired_prefix) {
			        socket.emit('error', {msg: "No prefix to calculate for.  Perhaps your session expired or you've disabled cookies?  Please contact us for help, especially if this is a paid address."});
			        socket.disconnect();
			    } else {
			        if (sessionData.cost > 0) {
			            checkPayment(socket, sessionData);
			        } else {
			            processAddress(socket, sessionData);
			        }
				}
		    }
		});
	});
});

function checkPayment(socket, session) {
    socket.emit('message', {msg: "Waiting for payment to clear..."});
    var options = {
        host: 'bitpay.com',
        path: '/api/invoice/'+session.bitpay_invoice_id,
        method: 'GET',
        headers: {
                  'Authorization': 'Basic '+new Buffer(require('secrets').BITPAY_API_KEY+":",'utf8').toString('base64')
              }
    };
    var response = '';
    var bitpay_req = https.request(options, function (bitpay_resp) {
        bitpay_resp.on('data', function(data) { 
            response += data;
        });
        bitpay_resp.on('end', function() {
            console.log(response);
            response = JSON.parse(response);
            switch (response.status) {
                case "confirmed":
                    socket.emit('message', {msg: "Payment received!  Preparing to calculate address..."});
                    setTimeout(function() {
                        processAddress(socket, session);
                    }, 4000);
                    break;
                case "expired":
                    socket.emit('error', {msg: "Your invoice has expired.  Please <a href='/'>start over</a> to get your address."});
                    break;
                case "invalid":
                    socket.emit('error', {msg: "There was an error with your invoice.  Please contact us and reference order "+response.id+" for assistance."});
                    break;
                default:
                    setTimeout(function() {
                        checkPayment(socket, session);
                    }, 5000);
                    break;
            }
        });            
    });
    bitpay_req.write();
    bitpay_req.end();
}

/* the meat */
var spawn = require('child_process').spawn;

function processAddress(socket, session) {
    socket.emit('message', {msg: "Preparing to calculate address..."});
	var threads = 1;
	var full_prefix = "1"+session.desired_prefix
	switch (full_prefix.length) {
		case 1:
		case 2:
			threads = 1;
			break;
		case 3:
		case 4: /* 25% of effort to these values */
			threads = Math.ceil(VANITYGEN_MAX_THREADS / 4);
			break;
		case 5: /* 50% effort */
			threads = Math.ceil(VANITYGEN_MAX_THREADS / 2);
			break;
		default: /* Full effort */
			threads = VANITYGEN_MAX_THREADS;
			break;
	}
    var vanitygen = spawn('lib/vanitygen/vanitygen', ['-t',threads,full_prefix]);
    vanitygen.on('exit', function(code, signal) {
		console.log("Generation for {0} ended code {1}".f(full_prefix, code));
    });
    vanitygen.stdout.on('data', function(data) {
		data = data.toString();
		console.log(data);
		console.log('--');
		var pieces = data.match(VANITYGEN_REGEXP);
		if (pieces) {
			socket.emit('message', {msg: "I'm working at {0}, and have gone through ~{1} possibilities.<br/>There's a {2} chance of my finishing in {3}.".f(
					pieces[1], pieces[2], pieces[3], pieces[4])
			});
		} else {
			var pieces = data.match(VANITYGEN_FINAL_REGEXP);
			if (pieces) {
		        socket.emit('message', {
					title: "Finished!", 
					block: "We've generated this private key for your new vanity address <strong>{0}</strong>.  Be sure to copy both the address and private key before leaving this page - we cannot generate it again for you!".f(pieces[1]),
					msg: "Private Key: <strong>{0}</strong>".f(pieces[2]),
					finished: true
				});
				socket.disconnect();
			}
		}
    });
    vanitygen.stderr.on('data', function(data) {
		console.log("Error output from prefix {0}\n---{1}\n---".f(full_prefix, data.toString()));
    });
}
