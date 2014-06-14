var fs = require('fs');
var hr = require('../hummusrenderer');



fs.readFile('./doc.json',function(err,inData)
{
    var fileStream = new hr.PDFStreamForFile('./output/basicDocument.pdf');
	if(err) throw err;
	hr.render(JSON.parse(inData),
                fileStream,
                {log:'./output/basicDocument.log',cleanExternals:true},
                function(){fileStream.close()});
});



