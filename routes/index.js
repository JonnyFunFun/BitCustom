/* some requirements */
var crypto = require('crypto'),
    https = require('https'),
	Email = require('email').Email,
    Recaptcha = require('recaptcha').Recaptcha;

var PUBLIC_KEY  = '6Lcah9YSAAAAALc3LssHAxUCG4j1FlT62lHWkpOR',
    PRIVATE_KEY = '6Lcah9YSAAAAAFYRKEJzh3INvNrGK3pKKMit-8XH';
var b58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/* secret variables! */
var secrets = require('../secrets.js');

/*
 * GET home page.
*/

exports.index = function(req, res){
	res.render('index', {'errors': req.session.errors, 'success': req.session.success});
	if (req.session.errors)
		req.session.errors = null;
	if (req.session.success) 
		req.session.success = null;
    req.session.regenerate(function(e){ if(e) console.log(e); });
    req.session.save();
    console.log("SESSION /index/ " + req.sessionID);
};

/*
 * GET tou page.
*/

exports.tou = function(req, res){
	res.render('tou', {'errors': req.session.errors});
	if (req.session.errors)
		req.session.errors = null;
    console.log("SESSION /tou/" + req.sessionID);

};

/*
 * GET about page.
 */

exports.about = function(req, res){
    res.render('about', {'errors': req.session.errors});
    if (req.session.errors)
        req.session.errors = null;
    console.log("SESSION /about/ " + req.sessionID);

};

/*
 * GET contact page.
 */

exports.contact = function(req, res){
	var recaptcha = new Recaptcha(PUBLIC_KEY, PRIVATE_KEY);
    res.render('contact', {'errors': req.session.errors, 'captcha': recaptcha.toHTML(), 'form':
		{
			'email': (req.session.contact ? req.session.contact.email : ''), 
			'message': (req.session.contact ? req.session.contact.message : '')
		}
	});
    if (req.session.errors)
        req.session.errors = null;
    console.log("SESSION /contact/ " + req.sessionID);

};

/*
 * POST contact send page.
 */

exports.contact_send = function(req, res){
	var data = {
	    remoteip:  req.connection.remoteAddress,
        challenge: req.body.recaptcha_challenge_field,
        response:  req.body.recaptcha_response_field
    };
    var recaptcha = new Recaptcha(PUBLIC_KEY, PRIVATE_KEY, data);

	recaptcha.verify(function(success, error_code) {
        if (success) {
			var msg = new Email(
				{
					from: req.param('email'),
					to: 'jonnyfunfun@gmail.com',
					subject: 'BitCustom Web Contact Form',
					body: req.param('message')
				});
			msg.send(function (err) {
				console.log(err);
			});
			req.session.success = "Your message was sent successfully!";
			req.session.cookie.expires = false;
			return res.redirect('/');
        }
        else {
			req.session.contact = {'email': req.param('email'), 'message': req.param('message')};
			req.session.errors = "That captcha code was invalid!";
			req.session.cookie.expires = false;
			return res.redirect('/contact');
        }
    });
    console.log("SESSION /contact_send/ " + req.sessionID);

};

/*
 * GET process page.
 * the main magic
 */

exports.process = function(req, res) {
    req.session.save();
    res.render('process',{'c': req.param('c','')});
    console.log("SESSION /process/ " + req.sessionID);
};

/*
 * POST check page.
 */

exports.check = function(req, res){
	req.session.desired_prefix = req.param('prefix','');
	if (req.session.desired_prefix == '')
	{
		req.session.errors = "You have to give me a prefix to work with!"
		req.session.cookie.expires = false;
		return res.redirect('/');
	}
	if (req.param('tos_agree','off') != 'on')
	{
		req.session.errors = "You must agree to the Terms of Service!"
		req.session.cookie.expires = false;
		return res.redirect('/');
	}
    for (var i = 0; i < req.session.desired_prefix.length; i++) {
        if (b58Alphabet.indexOf(req.session.desired_prefix[i]) == -1) {
            req.session.errors = "Your prefix includes invalid characters!";
			req.session.cookie.expires = false;
            return res.redirect('/');
        }
    }
    switch (req.session.desired_prefix.length /* include the 1 */) {
        case 3:
            var cost = 0.1;
            break;
        case 4:
            var cost = 0.25;
            break;
        case 5:
            var cost = 0.7;
            break;
        case 6:
            var cost = 2;
            break;
		case 7:
			var cost = 4;
			break;
        default:
            var cost = 0;
            break;
    }
    req.session.fees = cost;
    if (cost > 0) {
		var cipher = crypto.createCipher('aes-256-cbc',secrets.ENCRYPTION_KEY);
		var crypted = cipher.update(req.sessionID,'utf8','hex') + cipher.final('hex');
        var post_data = JSON.stringify({
            'price': cost,
            'currency': 'BTC',
            'posData': req.sessionID,
            'transactionSpeed': 'high',
            'redirectURL': 'https://www.bitcustom.com/process?c='+crypted,
            'notificationEmail': 'jonnyfunfun@gmail.com',
            'itemDesc': 'BitCustom - 1'+req.session.desired_prefix,
            'itemCode': 'BTCST',
            'orderId': '1'+req.session.desired_prefix
            
        });
        var options = {
            host: 'bitpay.com',
            path: '/api/invoice',
            method: 'POST',
            headers: {
                      'Authorization': 'Basic '+new Buffer(secrets.BITPAY_API_KEY+":",'utf8').toString('base64'),
                      'Content-Type': 'application/json',
                      'Content-Length': post_data.length
                  }
        };
        var response = '';
        var bitpay_req = https.request(options, function (bitpay_resp) {
            bitpay_resp.on('data', function(data) { 
                console.log(data);
                response += data;
            });
            bitpay_resp.on('end', function() {
                console.log(response);
                response = JSON.parse(response);
                req.session.bitpay_invoice_id = response.id;
                req.session.save();
                res.render('check', {'prefix': req.session.desired_prefix, 'cost': req.session.fees, 'bp_invoice_id': req.session.bitpay_invoice_id, 'bp_url': response.url});
            });            
        });
        bitpay_req.write(post_data);
        bitpay_req.end();
    } else {
        req.session.save();
       	res.render('check', {'prefix': req.session.desired_prefix, 'cost': req.session.fees});
    }
    console.log("SESSION /check/ " + req.sessionID);
};
