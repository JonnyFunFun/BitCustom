var socket = io.connect(null,{query: 'c='+$('input#c').val(), secure: true});
var processing = true;
socket.on('message', function(data) {
	console.log(data);
	$('blockquote#feedback').html(data.msg);
	if (data.title) $('h4#title').html(data.title);
	if (data.block) $('div#main-message').html(data.block);
	if (data.finished) {
		processing = false;
		socket.disconnect();
	}
});
socket.on('error', function(data) {
	$('div#main-well').hide();
	$('p#error-message').html(data.msg);
	$('div#error-widget').removeClass('hide');
});
$(window).bind('beforeunload', function() {
	if (processing) {
		return "Are you sure you want to leave?  We will stop generating your address.  All current progress will be lost and you may not be able to come back to restart at all!  Click 'Cancel' to stay here and continue generating.";
	} else {
		return "Please ensure that you have written down your private key.  We CANNOT retreive it for you!  Click 'Cancel' to go back and ensure you have it copied.";
	}
});
