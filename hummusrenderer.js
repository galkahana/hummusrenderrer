module.exports.render = function(inDocument,inTargetStream,inOptions)
{
	var writer = require('hummus').createWriter(inTargetStream,inOptions);

	renderDocument(inDocument,writer);

	writer.end();
}


function renderDocument(inDocument,inPDFWriter)
{
	var width;
	var height;

	// render pages
	inDocument.pages.forEach(function(inPage)
	{
		// accumulate required properties [syntax test]
		width = inPage.width || width;
		height = inPage.height || height;

		var pdfPage = inPDFWriter.createPage(0,0,width,height);
		// render boxes
		if(inPage.boxes)
		{
			inPage.boxes.forEach(function(inBox)
			{
				renderBox(inBox,pdfPage,inPDFWriter);
			});
		}
		
		inPDFWriter.writePage(pdfPage);
	});
}

function renderBox(inBox,inPDFPage,inPDFWriter)
{
	if(inBox.items)
	{
		inBox.items.forEach(function(inItem)
		{
			renderItem(inBox,inItem,inPDFPage,inPDFWriter)
		});
	}
	else if(inBox.image)
		renderImageItem(inBox,inBox.image,inPDFPage,inPDFWriter);

}

function renderItem(inBox,inItem,inPDFPage,inPDFWriter)
{
	if(inItem.type == 'image')
		renderImageItem(inBox,inItem,inPDFPage,inPDFWriter);
}

function isArray(o) {
  return Object.prototype.toString.call(o) === '[object Array]';
}

function renderImageItem(inBox,inItem,inPDFPage,inPDFWriter)
{
	var opts = {};

	opts.index = inItem.index;
	opts.transformation = inItem.transformation;
	if(opts.transformation && !isArray(opts.transformation))
	{
		opts.transformation.width = inBox.width;
		opts.transformation.height = inBox.height;
	}

	inPDFWriter.startPageContentContext(inPDFPage).drawImage(inBox.left,inBox.bottom,inItem.path,opts);
}