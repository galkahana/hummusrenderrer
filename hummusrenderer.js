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
	else if(inBox.shape)
		renderShapeItem(inBox,inBox.shape,inPDFPage,inPDFWriter);

}

function renderItem(inBox,inItem,inPDFPage,inPDFWriter)
{
	switch(inItem.type)
	{
		case 'image': 
			renderImageItem(inBox,inItem,inPDFPage,inPDFWriter);
			break;
		case 'shape':
			renderShapeItem(inBox,inItem,inPDFPage,inPDFWriter);
	}

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

function renderShapeItem(inBox,inItem,inPDFPage,inPDFWriter)
{
	switch(inItem.method)
	{
		case 'rectangle':
			inPDFWriter.startPageContentContext(inPDFPage).drawRectangle(inBox.left,inBox.bottom,inItem.width,inItem.height,inItem.options);
			break;
		case 'square':
			inPDFWriter.startPageContentContext(inPDFPage).drawSquare(inBox.left,inBox.bottom,inItem.width,inItem.options);
			break;
		case 'circle':
			// translate bottom/left to center
			inPDFWriter.startPageContentContext(inPDFPage).drawCircle(inBox.left+inItem.radius,inBox.bottom+inItem.radius,inItem.radius,inItem.options);
			break;
		case 'path':
			// translate bottom left to paths points
			var args = inItem.points.slice();
			for(var i=0;i<args.length;i+=2)
			{
				args[i]+=inBox.left;
				args[i+1]+=inBox.bottom;
			}
			if(inItem.options)
				args.push(inItem.options);
			var cxt = inPDFWriter.startPageContentContext(inPDFPage);
			cxt.drawPath.apply(cxt,args);
			break;

	}
}