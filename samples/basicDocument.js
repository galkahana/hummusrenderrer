var fs = require('fs');
var hr = require('../hummusrenderer');

function PDFStreamForFile(inPath,inOptions)
{
    this.ws = fs.createWriteStream(inPath,inOptions);
    this.position = 0;
}

PDFStreamForFile.prototype.write = function(inBytesArray)
{
    if(inBytesArray.length > 0)
    {
		this.ws.write(new Buffer(inBytesArray));
        this.position+=inBytesArray.length;
        return inBytesArray.length;
    }
    else
        return 0;
};


PDFStreamForFile.prototype.getCurrentPosition = function()
{
    return this.position;
};


fs.readFile('./doc.json',function(err,inData)
{
	if(err) throw err;
	hr.render(JSON.parse(inData),new PDFStreamForFile('./output/basicDocument.pdf'),{log:'./output/basicDocument.log'});
});



