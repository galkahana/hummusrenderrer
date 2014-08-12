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
			try
			{
				var writer = hummus.createWriter(inTargetStream,inOptions);

				renderDocument(inDocument,writer,state);

				writer.end();			

				if(inOptions.cleanExternals)
					cleanExternals(state.externalsLocalFiles)

				if(inCallback)
					inCallback(state);
			}
			catch(err)
			{
				inCallback(state,err);
			}
		});

}


// internal state class
function RenderingState()
{
	this.externalsLocalFiles = {};
	this.boxIDToBox = {};
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
	inRenderingState.theDocument = inDocument;


	// render pages
	inDocument.pages.forEach(function(inPage)
	{
		inRenderingState.links = [];
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

		if(inRenderingState.links.length > 0)
		{
			inPDFWriter.pausePageContentContext(inPDFWriter.startPageContentContext(pdfPage));
			inRenderingState.links.forEach(function(link)
			{
				inPDFWriter.attachURLLinktoCurrentPage(link.link,link.rect[0],link.rect[1],link.rect[2],link.rect[3]);
			});
		}
		
		inPDFWriter.writePage(pdfPage);
	});
}

function renderBox(inBox,inPDFPage,inPDFWriter,inRenderingState)
{

	// render the box
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

	// collect box ID. collecting it after to allow reference in repeaters
	// [meaning, allow a later ID to override this ID]
	if(inBox.id)
		inRenderingState.boxIDToBox[inBox.id] = inBox;
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

	var imageItemMeasures = getImageItemMeasures(inItem,inPDFWriter,inRenderingState);

	if(inBox.top !== undefined && inBox.bottom == undefined)
	{
		if(typeof(inBox.top) == 'object')
			computeBoxTopFromAnchor(inBox,inPDFWriter,inRenderingState);
		inBox.bottom = inBox.top - (inBox.height !== undefined ? inBox.height:imageItemMeasures.height);
	}

	var left = getLeftForAlignment(inBox,inItem,inPDFWriter,inRenderingState);
	var imagePath = inRenderingState.getImageItemFilePath(inItem);
	if(imagePath)
		inPDFWriter.startPageContentContext(inPDFPage).drawImage(left,inBox.bottom,imagePath,opts);	

	if(inItem.link)
		inRenderingState.links.push({link:inItem.link,rect:[left,inBox.bottom,left+imageItemMeasures.width,inBox.bottom+imageItemMeasures.height]});

}

function getLeftForAlignment(inBox,inItem,inPDFWriter,inRenderingState)
{
	if(!inBox.alignment || inBox.alginment == "left")
		return inBox.left;
	else if(inBox.alignment == "right")
	{
		return inBox.left + inBox.width - getItemMeasures(inItem,inBox,inPDFWriter,inRenderingState).width;
	}
	else
	{
		// center
		return inBox.left + (inBox.width - getItemMeasures(inItem,inBox,inPDFWriter,inRenderingState).width)/2;
	}
}

function renderShapeItem(inBox,inItem,inPDFPage,inPDFWriter,inRenderingState)
{

	if(inBox.top !== undefined && inBox.bottom == undefined)
	{
		if(typeof(inBox.top) == 'object')
			computeBoxTopFromAnchor(inBox,inPDFWriter,inRenderingState);
		inBox.bottom = inBox.top - (inBox.height !== undefined ? inBox.height:getShapeItemMeasures(inItem).height);
	}

	var left = getLeftForAlignment(inBox,inItem,inPDFWriter,inRenderingState);

	switch(inItem.method)
	{
		case 'rectangle':
			inPDFWriter.startPageContentContext(inPDFPage).drawRectangle(left,inBox.bottom,inItem.width,inItem.height,inItem.options);
			break;
		case 'square':
			inPDFWriter.startPageContentContext(inPDFPage).drawSquare(left,inBox.bottom,inItem.width,inItem.options);
			break;
		case 'circle':
			// translate bottom/left to center
			inPDFWriter.startPageContentContext(inPDFPage).drawCircle(left+inItem.radius,inBox.bottom+inItem.radius,inItem.radius,inItem.options);
			break;
		case 'path':
			// translate bottom left to paths points
			var args = inItem.points.slice();
			for(var i=0;i<args.length;i+=2)
			{
				args[i]+=left;
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
	var theFont =  getFont(inPDFWriter,inRenderingState,inItem);
	if(!theFont)
			return;
	inItem.options.font = theFont;

	var theText = computeTextForItem(inItem);

	if(inBox.top !== undefined && inBox.bottom == undefined)
	{
		if(typeof(inBox.top) == 'object')
			computeBoxTopFromAnchor(inBox,inPDFWriter,inRenderingState);
		inBox.bottom = inBox.top - (inBox.height !== undefined ? inBox.height:getTextItemMeasures(inItem,inPDFWriter,inRenderingState).height);
	}

	var left = getLeftForAlignment(inBox,inItem,inPDFWriter,inRenderingState);

	inPDFWriter.startPageContentContext(inPDFPage).writeText(theText,left,inBox.bottom,inItem.options);

	if(inItem.link)
	{
		var measures = theFont.calculateTextDimensions(theText,inItem.options.size);
		inRenderingState.links.push({link:inItem.link,rect:[left+measures.xMin,inBox.bottom+measures.yMin,left+measures.xMax,inBox.bottom+measures.yMax]});
	}
}

function computeTextForItem(inItem)
{
	var theText = isArray(inItem.text) ? joinTextArray(inItem.text):inItem.text;
	if(inItem.direction == 'rtl')
		theText = esrever.reverse(theText); // need to reverse the text for PDF placement	
	else if(inItem.direction != 'ltr')
		theText = reverseRTLWords(theText);
	return theText;
}

function reverseRTLWords(theText)
{
	return theText.replace(/[\(,\),\s,\,,',;,:,-,",]?[\u0590-\u05FF,\uFB1D-\uFB4F]+[\(,\),\s,\,,',;,:,-,",\u0590-\u05FF,\uFB1D-\uFB4F]*/g,function(inMatch){return esrever.reverse(inMatch)});
}

function getTextItemMeasures(inItem,inPDFWriter,inRenderingState)
{
	var theFont = getFont(inPDFWriter,inRenderingState,inItem);
	if(theFont)
	{
		var measures =  theFont.calculateTextDimensions(computeTextForItem(inItem),inItem.options.size);
		return {width:measures.width,height:measures.yMax}; // note, taking yMax, and not height, because we want the ascent and not the descent, which is below the baseline!
	}
	else
	{
		return {width:0,height:0};
	}
}

function joinTextArray(inStringArray)
{
	var result = '';

	inStringArray.forEach(function(inElement){result+=inElement});

	return result;
}

function renderStreamItem(inBox,inItem,inPDFPage,inPDFWriter,inRenderingState)
{
	composeStreamItem(inBox,inItem,inPDFWriter,inRenderingState,function(inComposedLine){
		placeStreamLine(inComposedLine.yOffset,inComposedLine.items,inPDFPage,inPDFWriter,inRenderingState);
	});
	
}

function composeStreamItem(inBox,inItem,inPDFWriter,inRenderingState,inLinePlacementMethod)
{
	// it is possible to define a stream item with no height, that
	// simply wraps the text according to width till the stream is ended.
	// it is possible to define also height, and then the stream will stop placement when 
	// height is consumed.
	// if height is provided than placement is from bottom+height going down, or bottom.top, if defined. otherwise it is from bottom
	// (where bottom would serve as top for the stream) or top, if defiend
	var xOffset = inBox.left;
	var directionIsRTL = inItem.direction == 'rtl';

	if(inBox.top !== undefined && inBox.bottom == undefined)
	{
		if(typeof(inBox.top) == 'object')
			computeBoxTopFromAnchor(inBox,inPDFWriter,inRenderingState);
		inBox.bottom = inBox.top - (inBox.height !== undefined ? inBox.height:0);
	}
	var originalTop = (inBox.top !== undefined ? inBox.top : (inBox.bottom + (inBox.height !== undefined ? inBox.height:0)));

	var lineInComposition =  {
		items:[],
		width:0,
		height:0,
		yOffset:originalTop,
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
			inLinePlacementMethod(this);
			// save lower composition position for later composition queries
			inItem.lowestContentOffset = this.yOffset;
			inItem.contentHeight = originalTop - inItem.lowestContentOffset;
			this.reset();
		}
	};

	var itemsInBox = expendItemsForStreamPlacement(inItem.items);

	for(var i=0;i<itemsInBox.length;++i)
	{
		if(lineInComposition.items.length == 0 && itemsInBox[i].isSpaces)
			continue;

		var itemMeasures = getStreamContentItemMeasures(itemsInBox[i],inPDFWriter,inRenderingState);

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
	{
		// right before placing, apply alignment considerations
		if(directionIsRTL)
		{
			var offset = 0;
			// direction RTL defaults to right, so change only if alingment is center or left
			if(inBox.alignemnt == 'center')
				offset = (lineInComposition.width-inBox.width)/2;
			else if(inBox.alignment == 'left')
				offset = (lineInComposition.width-inBox.width);
			if(offset != 0)
			{
				lineInComposition.items.forEach(function(item)
				{
					item.xPosition+=offset;
				});
			}
		}
		else
		{
			// not RTL defaults to left, so change only if alignmetn is center or right
			var offset = 0;
			// direction RTL defaults to right, so change only if alingment is center or left
			if(inBox.alignemnt == 'center')
				offset = (inBox.width-lineInComposition.width)/2;
			else if(inBox.alignment == 'right')
				offset = (inBox.width-lineInComposition.width)/2;
			if(offset != 0)
			{
				lineInComposition.items.forEach(function(item)
				{
					item.xPosition+=offset;
				});
			}			
		}

		lineInComposition.placeLine();
	}
}

function computeBoxTopFromAnchor(inBox,inPDFWriter,inRenderingState)
{
	/* 
		compute box top according to another box bottom, and an optional offset. this method
		of placement is used when looking to place "rows" of items one below the other, and not necesserily knowing
		where the items may be posited horizontal-wise. especially important when streams are placed, which have different
		content height per the composition
	*/

	var theAnchoredBox = (typeof(inBox.top.box) == 'object') ? inBox.top.box : getBoxByID(inBox.top.box,inRenderingState);

	inBox.top = getBoxBottom(theAnchoredBox,inPDFWriter,inRenderingState) + (inBox.top.offset ? inBox.top.offset:0);
}

function getBoxByID(inBoxID,inRenderingState)
{
	if(inRenderingState.boxIDToBox[inBoxID])
		return inRenderingState.boxIDToBox[inBoxID];

	// if mapping exists due to natural order of rendering, good. if not, loop now all boxes
	calculateBoxIDsToBoxes(inRenderingState);
	return inRenderingState.boxIDToBox[inBoxID];
}

function calculateBoxIDsToBoxes(inRenderingState)
{
	inRenderingState.theDocument.pages.forEach(function(inPage)
	{
		if(inPage.boxes)
		{
			inPage.boxes.forEach(function(inBox)
			{
				if(inBox.id)
					inRenderingState.boxIDToBox[inBox.id] = inBox;
			});
		}
	});
}

function getBoxBottom(inBox,inPDFWriter,inRenderingState)
{
	// if bottom exists, return it, unless it's a "bottom" that's
	// actually top, which is the case for a box that contains a stream
	// and does not have height defined
	if(inBox.bottom !== undefined && !(inBox.height === undefined && doesBoxHaveStream(inBox)))
		return inBox.bottom;

	// bottom does not exist, need to calculate per top, or per the case of heightless box that contains stream
	if(inBox.top !== undefined)
	{
		if(typeof(inBox.top) == 'object')
			computeBoxTopFromAnchor(inBox,inPDFWriter,inRenderingState);
	}

	if(inBox.top !== undefined)
	{
		if(inBox.height !== undefined)
		{
			// case has top - simply substract
			return inBox.top - inBox.height;
		}
		else
		{
			// only top, but no height. so calculate height per items and substract from top
			return inBox.top - calculateBoxItemsHeight(inBox,inPDFWriter,inRenderingState);
		}
	}
	else if(inBox.bottom !== undefined && inBox.height === undefined)
	{
		// case has bottom but no height - which necesserily means that there's a stream object here per the test at the top
		// calculate height from items and remove from bottom (which is actually top)
		return inBox.bottom - calculateBoxItemsHeight(inBox,inPDFWriter,inRenderingState);
	}
	else
		return 0; // no top, no bottom...shouldn't happen
}

function doesBoxHaveStream(inBox)
{
	if(inBox.items)
	{
		var i = 0;
		for(;i<inBox.items.length;++i)
			if(inBox.items[i].type == 'stream')
				break;
		return i<inBox.items.length;
	}
	else 
		return inBox.stream;
}

function calculateBoxItemsHeight(inBox,inPDFWriter,inRenderingState)
{
	if(inBox.items)
	{
		var maxHeight = 0;
		inBox.items.forEach(function(inItem)
		{
			maxHeight = Math.max(getItemMeasures(inItem,inBox,inPDFWriter,inRenderingState).height,maxHeight);
		});
		return maxHeight;
	}
	else if(inBox.image)
		return getImageItemMeasures(inBox.image,inPDFWriter,inRenderingState,inBox).height;
	else if(inBox.shape)
		return getShapeItemMeasures(inBox.shape,inPDFWriter,inRenderingState).height;
	else if(inBox.text)
		return getTextItemMeasures(inBox.text,inPDFWriter,inRenderingState).height;
	else if(inBox.stream)
		return getComosedStreamMeasures(inBox,inBox.stream,inPDFWriter,inRenderingState).height;
}

function getItemMeasures(inItem,inBox,inPDFWriter,inRenderingState)
{
	var result;
	var itemType = inItem.type ? inItem.type:getBoxItemType(inBox);
	switch(itemType)
	{
		case 'image': 
			result = getImageItemMeasures(inItem,inPDFWriter,inRenderingState,inBox);
			break;
		case 'shape':
			result = getShapeItemMeasures(inItem,inPDFWriter,inRenderingState);
			break;
		case 'text':
			result = getTextItemMeasures(inItem,inPDFWriter,inRenderingState);
			break;
		case 'stream':
			result = getComosedStreamMeasures(inBox,inItem,inPDFWriter,inRenderingState);
			break;
	}

	return result;
}

function getBoxItemType(inBox)
{
	if(inBox.text)
		return 'text';
	else if(inBox.shape)
		return 'shape';
	else if(inBox.image)
		return 'image';
	else
		return 'stream';
}

function getImageItemMeasures(inItem,inPDFWriter,inRenderingState,inBox)
{
	var result;
	var imagePath = inRenderingState.getImageItemFilePath(inItem);
	
	if(inItem.transformation)
	{
		if(isArray(inItem.transformation))
		{
			if(imagePath)
			{
				var imageDimensions = inPDFWriter.getImageDimensions(imagePath);
				var bbox = [0,0,imageDimensions.width,imageDimensions.height];
				var transformedBox = transformBox(bbox,inItem.transformation);
				result = {width:transformedBox[2],height:transformedBox[3]};
			}
			else
				result = {width:0,height:0};
		}
		else
			result = {width:inItem.transformation.width == undefined ? inBox.width : inItem.transformation.width,
						height:inItem.transformation.height == undefined ? inBox.height : inItem.transformation.height};
	}
	else if(imagePath)
		result = inPDFWriter.getImageDimensions(inRenderingState.getImageItemFilePath(inItem)); 
	else
		result = {width:0,height:0}; 

	return result;
}

function getShapeItemMeasures(inItem)
{
	var result;

	switch(inItem.method)
	{
		case 'rectangle':
			result = {width:inItem.width,height:inItem.height};
			break;
		case 'square':
			result = {width:inItem.width,height:inItem.width};
			break;
		case 'circle':
			result = {width:inItem.radius*2,height:inItem.radius*2};
			break;
		case 'path':
			var maxTop=0,
				maxRight=0;
			for(var i=0;i<inItem.points.length;i+=2)
			{
				if(inItem.points[i]> maxRight)
					maxRight = inItem.points[i];
				if(inItem.points[i+1]>maxTop)
					maxTop = inItem.points[i+1];
			}
			result = {width:maxRight,height:maxTop};
			break;
		default:
			result = {width:0,height:0};
	}	
	return result;				
}

function getComosedStreamMeasures(inBox,inItem,inPDFWriter,inRenderingState)
{	
	// composition saves the lowest line positioning in lowestContentOffset. if not done yet, compose on empty and save now.
	if(inItem.lowestContentOffset == undefined)
		composeStreamItem(inBox,inItem,inPDFWriter,inRenderingState,function(){});

	return {bottom:inItem.lowestContentOffset,height:inItem.contentHeight};
}

function getStreamContentItemMeasures(inItem,inPDFWriter,inRenderingState)
{
	if(inItem.item.width && inItem.item.height)
	{
		return {width:inItem.item.width,height:inItem.item.height};
	}

	var result;

	switch(inItem.item.type)
	{
		case 'image': 
			result = getImageItemMeasures(inItem.item,inPDFWriter,inRenderingState);
			break;
		case 'shape':
			result = getShapeItemMeasures(inItem.item);
			break;
		case 'text':
			var theFont = getFont(inPDFWriter,inRenderingState,inItem.item);
			if(theFont)
			{
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
			}
			else
				result = {width:0,height:0};
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