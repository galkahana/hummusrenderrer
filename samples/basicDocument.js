var fs = require('fs');
var hr = require('../hummusrenderer');


['basicDocument','elementsWithTop'].forEach(function(inDocFileName)
{
	fs.readFile('./' + inDocFileName + '.json',function(err,inData)
	{
	    var fileStream = new hr.PDFStreamForFile('./output/' + inDocFileName + '.pdf');
		if(err) throw err;
		hr.render(JSON.parse(inData),
	                fileStream,
	                {log:'./output/' + inDocFileName + '.log',cleanExternals:true},
	                function(){fileStream.close()});
	});
});




