var hummus = require('hummus'),
	tmp = require('temporary'),
	http = require('http'),
	https = require('https'),
	esrever = require('esrever'),
	fs = require('fs');



module.exports.render = function(inDocument,inTargetStream,inOptions,inCallback)
{
	var state = new RenderingState();

	downloadExternals(inDocument.externals,function(inDownloadMap)
		{
			state.externalsLocalFiles = inDownloadMap;
			var writer = hummus.createWriter(inTargetStream,inOptions);

			renderDocument(inDocument,writer,state);

			writer.end();			

			if(inOptions.cleanExternals)
				cleanExternals(state.externalsLocalFiles)

			if(inCallback)
				inCallback(state);
		});

}


// internal state class
function RenderingState()
{
	this.externalsLocalFiles = {};
}


RenderingState.prototype.getLocalFile = function(inExternalName)
{
	return this.externalsLocalFiles(inExternalName);
};


RenderingState.prototype.getImageItemFilePath = function(inItem)
{
	if(inItem.path)
		return inItem.path;
	else if(inItem.external)
		return this.externalsLocalFiles[inItem.external];
	else
		return null;
};

RenderingState.prototype.getFontItemFilePath = function(inItem)
{
	if(inItem.options.fontPath)
		return inItem.options.fontPath;
	else if(inItem.options.fontExternal)
		return this.externalsLocalFiles[inItem.options.fontExternal];
	else
		return null;
};

RenderingState.prototype.getFontSecondItemFilePath = function(inItem)
{
	if(inItem.options.fontSecondPath)
		return inItem.options.fontSecondPath;
	else if(inItem.options.fontSecondExternal)
		return this.externalsLocalFiles[inItem.options.fontSecondExternal];
	else
		return null;
};

// download all externals
function downloadExternals(inExternals,inCallback)
{
	if(!inExternals || Object.keys(inExternals).length == 0)
	{
		inCallback({});
		return;
	}

	var downloadMap = {};
	var keys = Object.keys(inExternals);
	var index = 0;

	downloadFile(inExternals[keys[index]],new tmp.File().path,function(inTargetFilePath,inThis)
		{
			downloadMap[keys[index]] = inTargetFilePath;
			++index;
			if(index < keys.length)
				downloadFile(inExternals[keys[index]],new tmp.File().path,inThis);
			else
				inCallback(downloadMap);
		});


}

function downloadFile(inFileURL,inTargetFilePath,inCallback)
{

	var file = fs.createWriteStream(inTargetFilePath);
	var theDownloadService = inFileURL.substring(0,5) == 'https' ? https:http;
	var request = theDownloadService.get(inFileURL, function(response) {
  		response.pipe(file);
		file.on('finish', function() {
		      file.close(inCallback.bind(null,inTargetFilePath,inCallback));
		    });  		
	});	
}

// main rendering method (when all externals are downloaded)
function renderDocument(inDocument,inPDFWriter,inRenderingState)
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
				renderBox(inBox,pdfPage,inPDFWriter,inRenderingState);
			});
		}
		
		inPDFWriter.writePage(pdfPage);
	});
}

function renderBox(inBox,inPDFPage,inPDFWriter,inRenderingState)
{
	if(inBox.items)
	{
		inBox.items.forEach(function(inItem)
		{
			renderItem(inBox,inItem,inPDFPage,inPDFWriter,inRenderingState)
		});
	}
	else if(inBox.image)
		renderImageItem(inBox,inBox.image,inPDFPage,inPDFWriter,inRenderingState);
	else if(inBox.shape)
		renderShapeItem(inBox,inBox.shape,inPDFPage,inPDFWriter,inRenderingState);
	else if(inBox.text)
		renderTextItem(inBox,inBox.text,inPDFPage,inPDFWriter,inRenderingState);
	else if(inBox.stream)
		renderStreamItem(inBox,inBox.stream,inPDFPage,inPDFWriter,inRenderingState);

}

function renderItem(inBox,inItem,inPDFPage,inPDFWriter,inRenderingState)
{
	switch(inItem.type)
	{
		case 'image': 
			renderImageItem(inBox,inItem,inPDFPage,inPDFWriter,inRenderingState);
			break;
		case 'shape':
			renderShapeItem(inBox,inItem,inPDFPage,inPDFWriter,inRenderingState);
			break;
		case 'text':
			renderTextItem(inBox,inItem,inPDFPage,inPDFWriter,inRenderingState);
			break;
		case 'stream':
			renderStreamItem(inBox,inItem,inPDFPage,inPDFWriter,inRenderingState);
			break;
	}

}

function isArray(o) {
  return Object.prototype.toString.call(o) === '[object Array]';
}

function renderImageItem(inBox,inItem,inPDFPage,inPDFWriter,inRenderingState)
{
	var opts = {};

	opts.index = inItem.index;
	opts.transformation = inItem.transformation;
	if(opts.transformation && !isArray(opts.transformation) &&
		!opts.transformation.width &&
		!opts.transformation.height)
	{
		opts.transformation.width = inBox.width;
		opts.transformation.height = inBox.height;
	}

	inPDFWriter.startPageContentContext(inPDFPage).drawImage(inBox.left,inBox.bottom,inRenderingState.getImageItemFilePath(inItem),opts);
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

function renderTextItem(inBox,inItem,inPDFPage,inPDFWriter,inRenderingState)
{
	inItem.options.font = getFont(inPDFWriter,inRenderingState,inItem);

	var theText = isArray(inItem.text) ? joinTextArray(inItem.text):inItem.text;
	if(inItem.direction == 'rtl')
		theText = esrever.reverse(theText); // need to reverse the text for PDF placement

	inPDFWriter.startPageContentContext(inPDFPage).writeText(theText,inBox.left,inBox.bottom,inItem.options);
}

function joinTextArray(inStringArray)
{
	var result = '';

	inStringArray.forEach(function(inElement){result+=inElement});

	return result;
}


function renderStreamItem(inBox,inItem,inPDFPage,inPDFWriter,inRenderingState)
{
	// it is possible to define a stream item with no height, that
	// simply wraps the text according to width till the stream is ended.
	// it is possible to define also height, and then the stream will stop placement when 
	// height is consumed.
	// if height is provided than placement is from bottom+height going down. otherwise it is from bottom
	// (where bottom would serve as top fo the stream)
	var xOffset = inBox.left;
	var directionIsRTL = inItem.direction == 'rtl';

	var lineInComposition =  {
		items:[],
		width:0,
		height:0,
		yOffset:inBox.bottom + (inBox.height !== undefined ? inBox.height:0),
		firstLine:true,
		leading:inItem.leading ? inItem.leading:1.2,
		reset:function()
		{
			this.items = [];
			this.width = 0;
			this.height = 0;
			this.firstLine = false;
		},
		lineSpacingModifier:function()
		{
			return this.firstLine?1:this.leading;
		},
		lineSpacing:function()
		{
			return this.height*this.lineSpacingModifier();
		},
		placeLine:function()
		{
			this.yOffset -= this.lineSpacing();
			placeStreamLine(this.yOffset,this.items,inPDFPage,inPDFWriter,inRenderingState);
			this.reset();
		}
	};

	var itemsInBox = expendItemsForStreamPlacement(inItem.items);

	for(var i=0;i<itemsInBox.length;++i)
	{
		if(lineInComposition.items.length == 0 && itemsInBox[i].isSpaces)
			continue;

		var itemMeasures = getItemMeasures(itemsInBox[i],inPDFWriter,inRenderingState);

		if(itemsInBox[i].isNewLine)
		{
			if(inBox.height !== undefined &&
				lineInComposition.yOffset - itemMeasures.height*lineInComposition.lineSpacingModifier() < inBox.bottom)
			{
				// newline overflow, break
				break;
			}

			if(lineInComposition.items.length > 0)
			{
				// place current line, and move on
				lineInComposition.placeLine();
			}
			else
			{
				// empty line, just increase yOffset per the newline height. no need
				lineInComposition.Offset -= itemMeasures.height*lineInComposition.lineSpacingModifier();
				lineInComposition.reset();
			}
		}
		else
		{
			// check for overflow if will place the element
			if(lineInComposition.width + itemMeasures.width > inBox.width ||
				(inBox.height !== undefined &&
					lineInComposition.yOffset - itemMeasures.height*lineInComposition.lineSpacingModifier() < inBox.bottom))
			{
				lineInComposition.placeLine();

				// skip if spaces
				if(itemsInBox[i].isSpaces)
					continue;

			}


			// check if element alone overflows, if so, quit
			if(itemMeasures.width > inBox.width ||
				(inBox.height !== undefined &&
					lineInComposition.yOffset - itemMeasures.height*lineInComposition.lineSpacingModifier() < inBox.bottom))
			{
				break;
			}		

			// items is OK for placement in line, so do so, and update its state
			itemsInBox[i].xPosition = directionIsRTL ? (xOffset + inBox.width - lineInComposition.width - itemMeasures.width): (xOffset+lineInComposition.width);
			lineInComposition.items.push(itemsInBox[i]);
			lineInComposition.width+=itemMeasures.width;
			lineInComposition.height = Math.max(lineInComposition.height,lineInComposition.firstLine || itemsInBox[i].item.type != 'text' ? itemMeasures.height:itemsInBox[i].item.options.size);
		}
	}

	// if line is not empty, place it now
	if(lineInComposition.items.length > 0)
		lineInComposition.placeLine();
}


function getItemMeasures(inItem,inPDFWriter,inRenderingState)
{
	if(inItem.item.width && inItem.item.height)
	{
		return {width:inItem.item.width,height:inItem.item.height};
	}

	var result;

	switch(inItem.item.type)
	{
		case 'image': 
			if(inItem.item.transformation)
			{
				if(isArray(inItem.item.transformation))
				{
					var imageDimensions = inPDFWriter.getImageDimensions(inRenderingState.getImageItemFilePath(inItem.item));
					var bbox = [0,0,imageDimensions.width,imageDimensions.height];
					var transformedBox = transformBox(bbox,inItem.item.transformation);
					result = {width:transformedBox[2],height:transformedBox[3]};
				}
				else
					result = {width:inItem.item.transformation.width,
								height:inItem.item.transformation.height};
			}
			else
				result = inPDFWriter.getImageDimensions(inRenderingState.getImageItemFilePath(inItem.item)); 
			break;
		case 'shape':
			switch(inItem.item.method)
			{
				// rectangle is taken care off earlier
				case 'square':
					result = {width:inItem.item.width,height:inItem.item.width};
					break;
				case 'circle':
					result = {width:inItem.item.radius*2,height:inItem.item.radius*2};
					break;
				case 'path':
					var maxTop=0,
						maxRight=0;
					for(var i=0;i<inItem.item.points.length;i+=2)
					{
						if(inItem.item.points[i]> maxRight)
							maxRight = inItem.item.points[i];
						if(inItem.item.points[i+1]>maxTop)
							maxTop = inItem.item.points[i+1];
					}
					break;
				default:
					result = {width:0,height:0};
			}				
			break;
		case 'text':
			var theFont = getFont(inPDFWriter,inRenderingState,inItem.item);
			// got some bug with spaces that does not allow proper measurements
			if(inItem.isSpaces)
			{
				var measures = theFont.calculateTextDimensions('a'+inItem.item.text+'a',inItem.item.options.size);
				var measuresA = theFont.calculateTextDimensions('aa',inItem.item.options.size);
				result = {width:measures.width-measuresA.width,height:theFont.calculateTextDimensions('d',inItem.item.options.size).yMax}; // height is ascent which is approximately the height of d
			}
			else if(inItem.isNewLine)
			{
				result = {width:0,height:theFont.calculateTextDimensions('d',inItem.item.options.size).yMax}; // height is ascent which is approximately the height of d
			}
			else
			{
				var theText = inItem.item.text;
				if(inItem.item.direction == 'rtl')
					theText = esrever.reverse(theText); // need to reverse the text for PDF placement

				var measures = theFont.calculateTextDimensions(theText,inItem.item.options.size);
				result = {width:measures.width,height:measures.yMax}; // note, taking yMax, and not height, because we want the ascent and not the descent, which is below the baseline!
			}
			break;
		default:
			result = {width:0,height:0};
	}
	return result;
}

function getFont(inPDFWriter,inRenderingState,inItem)
{
	var result; 
	var fontPath = inRenderingState.getFontItemFilePath(inItem);
	var secondPath = inRenderingState.getFontSecondItemFilePath(inItem);
	if(fontPath)
	{
		var secondArg = secondPath ? (secondPath) : ((inItem.options && inItem.options.fontIndex) ? inItem.options.fontIndex : null);
		result = secondArg ? inPDFWriter.getFontForFile(fontPath,secondArg) : inPDFWriter.getFontForFile(fontPath);
	}
	else
		result = inItem.options.font;

	return result;
}

function transformBox(inBox,inMatrix)
{
    if(!inMatrix)
        return inBox;
    
    var t = new Array(4);
    t[0] = transformVector([inBox[0],inBox[1]],inMatrix);
    t[1] = transformVector([inBox[0],inBox[3]],inMatrix);
    t[2] = transformVector([inBox[2],inBox[3]],inMatrix);
    t[3] = transformVector([inBox[2],inBox[1]],inMatrix);
    
    var minX,minY,maxX,maxY;
    
    minX = maxX = t[0][0];
    minY = maxY = t[0][1];
    
    for(var i=1;i<4;++i)
    {
        if(minX > t[i][0])
            minX = t[i][0];
        if(maxX < t[i][0])
            maxX = t[i][0];
        if(minY > t[i][1])
            minY = t[i][1];
        if(maxY < t[i][1])
            maxY = t[i][1];
    }
    
    return [minX,minY,maxX,maxY];
}


function transformVector(inVector,inMatrix) 
{
    
    if(!inMatrix)
        return inVector;
    
    return [inMatrix[0]*inVector[0] + inMatrix[2]*inVector[1] + inMatrix[4],
    		inMatrix[1]*inVector[0] + inMatrix[3]*inVector[1] + inMatrix[5]];
}

function expendItemsForStreamPlacement(inItems)
{
	var result = [];

	/*
		expanding mostly places the items in minimal containers
		and expands text items to their worlds/spaces/newlines, for later
		simplified placement
	*/

	inItems.forEach(function(inItem)
	{
		if(inItem.type == "text")
		{
			// split text to its components
			var theText = isArray(inItem.text) ? joinTextArray(inItem.text):inItem.text;

			var textComponents = theText.match(/[^\s\r\n]+|[^\S\r\n]+|\r\n|\n|\r/g);
			if(textComponents)
			{
				textComponents.forEach(function(inText)
				{
					var itemCopy = shallowCopy(inItem);
					itemCopy.text = inText;
					result.push(
						{
							item:itemCopy,
							isSpaces:inText.search(/[^\S\r\n]/) != -1,
							isNewLine:inText.search(/\r|\n/) != -1
						});
				});
			}
		}
		else
		{
			result.push({item:inItem});
		}
	});


	return result;
}

function shallowCopy(inItem)
{
	var newItem = {};
	for(var v in inItem)
	{
		if(inItem.hasOwnProperty(v))
			newItem[v] = inItem[v];
	}
	return newItem;
}

function placeStreamLine(inYOffset,inItems,inPDFPage,inPDFWriter,inRenderingState)
{
	inItems.forEach(function(inItem)
	{
		if(inItem.item.type)
		{
			// regular item, place using regular method, with a new box stating it's position
			renderItem({left:inItem.xPosition,bottom:inYOffset},inItem.item,inPDFPage,inPDFWriter,inRenderingState);
		}
		else
		{
			// a box. create a copy of the box, and replace the xOffset and yOffset
			// ponder:replacing. should i add? right now will not support non-0 coordinates
			// of box...oh well...we still have to figure out what its good for anyways
			var newBox = shallowCopy(inItem.item);
			newBox.left = inItem.xOffset;
			newBox.bottom = inYOffset;
			renderBox(newBox,inPDFPage,inPDFWriter,inRenderingState);
		}
	});
}


function cleanExternals(externalMap)
{
	for(var external in externalMap)
	{
		fs.unlink(externalMap[external]);
	}
}

function PDFStreamForFile(inPath,inOptions)
{
    this.ws = fs.createWriteStream(inPath,inOptions);
    this.position = 0;
    this.path = inPath;
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

PDFStreamForFile.prototype.close = function(inCallback)
{
	if(this.ws)
	{
		var self = this;

		this.ws.end(function()
		{
			self.ws = null;
			if(inCallback)
				inCallback();
		})
	}
	else
	{
		if(inCallback)
			inCallback();
	}
};

module.exports.PDFStreamForFile = PDFStreamForFile;
module.exports.PDFStreamForResponse = hummus.PDFStreamForResponse;