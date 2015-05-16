var hummus = require('hummus'),
	tmp = require('temporary'),
	http = require('http'),
	https = require('https'),
	bidi = require('gal-icu-bidi'),
	fs = require('fs');



module.exports.render = function(inDocument,inTargetStream,inOptions,inCallback)
{
	var state = new RenderingState();

	downloadExternals(inDocument.externals,function(inDownloadMap)
		{
			state.externalsLocalFiles = inDownloadMap;
			try
			{
				var writer;

				if(inDocument.source)
				{
					state.modifiedFileStream = new hummus.PDFRStreamForFile(inDocument.source.path ? 
																				inDocument.source.path : 
																				state.getLocalFile(inDocument.source.external));
					state.isModification = true;
					writer = hummus.createWriterToModify(state.modifiedFileStream,inTargetStream,inOptions);
				}
				else
					writer = hummus.createWriter(inTargetStream,inOptions);

				renderDocument(inDocument,writer,state);

				writer.end();	

        		
				if(inOptions.cleanExternals)
					cleanExternals(state.externalsLocalFiles)

				if(inCallback)
					inCallback();
			}
			catch(err)
			{
				inCallback(err);
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
	return this.externalsLocalFiles[inExternalName];
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

function NewPageDriver(inPDFWriter,inWidth,inHeight)
{
	this.pdfWriter = inPDFWriter;
	this.pdfPage = inPDFWriter.createPage(0,0,inWidth,inHeight);
}

NewPageDriver.prototype.startContentContext = function()
{
	return this.pdfWriter.startPageContentContext(this.pdfPage);
}

NewPageDriver.prototype.writePage = function(inLinks)
{
	if(inLinks.length > 0)
	{
		this.pdfWriter.pausePageContentContext(this.pdfWriter.startPageContentContext(this.pdfPage));
		var self = this;
		inLinks.forEach(function(link)
		{
			self.pdfWriter.attachURLLinktoCurrentPage(link.link,link.rect[0],link.rect[1],link.rect[2],link.rect[3]);
		});		
	}

	this.pdfWriter.writePage(this.pdfPage);
}

function ModifiedPageDriver(inPDFWriter,inPageIndex)
{
	this.pdfWriter = inPDFWriter;
	this.pageModifier = new hummus.PDFPageModifier(inPDFWriter,inPageIndex);
}

ModifiedPageDriver.prototype.startContentContext = function()
{
	return this.pageModifier.startContext().getContext();
}

ModifiedPageDriver.prototype.writePage = function(inLinks)
{
	if(this.pageModifier.getContext())
		this.pageModifier.endContext();

	if(inLinks.length > 0)
	{
		var self = this;
		inLinks.forEach(function(link)
		{
			self.pageModifier.attachURLLinktoCurrentPage(link.link,link.rect[0],link.rect[1],link.rect[2],link.rect[3]);
		});		
	}

	this.pageModifier.writePage();
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
		var thePageDriver;
		if(inPage.modifiedFrom !== undefined)
		{
			thePageDriver = new ModifiedPageDriver(inPDFWriter,inPage.modifiedFrom);
		}
		else
		{
			// accumulate required properties [syntax test]
			width = inPage.width || width;
			height = inPage.height || height;
			thePageDriver = new NewPageDriver(inPDFWriter,width,height);
		}

		// render boxes
		if(inPage.boxes)
		{
			inPage.boxes.forEach(function(inBox)
			{
				renderBox(inBox,thePageDriver,inPDFWriter,inRenderingState);
			});
		}

		thePageDriver.writePage(inRenderingState.links);
	});
}

function renderBox(inBox,inPDFPage,inPDFWriter,inRenderingState)
{

	// render the box
	if(inBox.items)
	{
		inBox.items.forEach(function(inItem)
		{
			renderItem(inBox,inItem,inPDFPage,inPDFWriter,inRenderingState);
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
		inPDFPage.startContentContext().drawImage(left,inBox.bottom,imagePath,opts);	

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
			inPDFPage.startContentContext().drawRectangle(left,inBox.bottom,inItem.width,inItem.height,inItem.options);
			break;
		case 'square':
			inPDFPage.startContentContext().drawSquare(left,inBox.bottom,inItem.width,inItem.options);
			break;
		case 'circle':
			// translate bottom/left to center
			inPDFPage.startContentContext().drawCircle(left+inItem.radius,inBox.bottom+inItem.radius,inItem.radius,inItem.options);
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
			var cxt = inPDFPage.startContentContext();
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

	inPDFPage.startContentContext().writeText(theText,left,inBox.bottom,inItem.options);


	if(inItem.link)
	{
		var measures = calculateTextDimensions(theFont,theText,inItem.options.size);
		inRenderingState.links.push({link:inItem.link,rect:[left+measures.xMin,inBox.bottom+measures.yMin,left+measures.xMax,inBox.bottom+measures.yMax]});
	}
}

function hasNonSpace(inText)
{
	return inText.match(/[^\s]/);
}

function calculateTextDimensions(inFont,inText,inFontSize)
{
	// calculate the text measures. handles a bug where space only strings don't get their correct measures
	if(hasNonSpace(inText))
	{
		// may be ending with space, in which case i'll get the same problem as having spaces...so do a similar trick..with no height this time
		if(inText.search(/[\s]*$/) != inText.length)
		{
			var measures = inFont.calculateTextDimensions(inText+'a',inFontSize);
			var measuresA = inFont.calculateTextDimensions('a',inFontSize);
			measures.width-=measuresA.xMax;
			measures.xMax-=measuresA.xMax;
			return measures;
		}
		else
			return inFont.calculateTextDimensions(inText,inFontSize);
	}
	else
	{
		var measures = inFont.calculateTextDimensions('a'+inText+'a',inFontSize);
		var measuresA = inFont.calculateTextDimensions('aa',inFontSize);
		var dMeasure = inFont.calculateTextDimensions('d',inFontSize);
		dMeasure.width = measures.width-measuresA.width;
		dMeasure.xMin = 0;
		dMeasure.xMax = dMeasure.width;
		return dMeasure;
	}
}
		

function computeTextForItem(inItem)
{
	var theText = isArray(inItem.text) ? joinTextArray(inItem.text):inItem.text;

	var p = bidi.Paragraph(theText,{paraLevel: inItem.direction == 'rtl' ? bidi.RTL:bidi.LTR});

	return p.writeReordered(bidi.Reordered.KEEP_BASE_COMBINING);
}

function getTextItemMeasures(inItem,inPDFWriter,inRenderingState)
{
	var theFont = getFont(inPDFWriter,inRenderingState,inItem);
	var theText = computeTextForItem(inItem);
	if(theFont && theText.length > 0)
	{
		var measures =  calculateTextDimensions(theFont,theText,inItem.options.size);
		return {width:measures.xMax,height:measures.yMax}; // note, taking yMax, and not height, because we want the ascent and not the descent, which is below the baseline!
															// also taking xMAx...cause i want the advance and not just the start to end glyphs area
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

function calculateBoxTopAndBottomForStream(inBox,inPDFWriter,inRenderingState)
{
	if(inBox.top !== undefined && inBox.bottom == undefined)
	{
		if(typeof(inBox.top) == 'object')
			computeBoxTopFromAnchor(inBox,inPDFWriter,inRenderingState);
		inBox.bottom = inBox.top - (inBox.height !== undefined ? inBox.height:0);
	}
}

function renderStreamItem(inBox,inItem,inPDFPage,inPDFWriter,inRenderingState)
{
	inRenderingState.pdfPage = inPDFPage;
	composeStreamItem(inBox,inItem,inPDFWriter,inRenderingState,renderRun);
}

function composeStreamItem(inBox,inItem,inPDFWriter,inRenderingState,inRenderRunMethod)
{
	calculateBoxTopAndBottomForStream(inBox,inPDFWriter,inRenderingState);

	var alignment = inBox.alignment === undefined ? (inItem.direction == 'rtl' ? 'right':'left'):inBox.alignment;


	// transform the stream items to a structure that is defined by a plain text stream
	// representing the stream text [non textual elements are represented by placeholder characters]
	// and an accompanying array providing run data (which is essentially inItem.items with index pointers into the text
	// stream array)
	var logicalLines = createLogicalTextDataLines(inItem);

	var top = (inBox.top !== undefined ? inBox.top : (inBox.bottom + (inBox.height !== undefined ? inBox.height:0)));
	var left = inBox.left;

	var lineCompositionState =  {
		height:0,
		xOffset:left,
		yOffset:top,
		firstLine:true,
		leading:inItem.leading ? inItem.leading:1.2,
		box:inBox,
		item:inItem,
		pdfWriter:inPDFWriter,
		renderingState:inRenderingState,
		renderRun:inRenderRunMethod,
		lineSpacingModifier:function()
		{
			return this.firstLine?1:this.leading;
		},
		lineSpacing:function()
		{
			return this.height*this.lineSpacingModifier();
		},
		startLine:function(inDirection,inWidth,inHeight)
		{
			// before a lign is rendered. when there's already knowledge
			// of the line width. setup alignment. the direction determines
			// the default if no alignment is defined
			if(alignment == 'center')
				this.xOffset += (inBox.width - inWidth)/2;
			else if(alignment == 'right')
				this.xOffset += (inBox.width - inWidth);

			// setup baseline for text placement
			this.height = inHeight;
			this.yOffset -= this.lineSpacing();
			inItem.lowestContentOffset = this.yOffset;
			inItem.contentHeight = top - inItem.lowestContentOffset;	
		},
		reset:function()
		{
			// ran after line is rendered and finished. prpare for next line
			this.xOffset = left;
			this.height = 0;
			this.firstLine = false;
		}
	};

	for(var i=0;i<logicalLines.length;++i)
	{
		// loop logical lines and place. lines may be broken further to allow for text wrap where required
		if(!composeLine(logicalLines[i],lineCompositionState))
			break; // will break on overflow
	}
}

var kDefaultInlineObjectChar = '?';

function createLogicalTextDataLines(inItem)
{
	var logicalLines = [];
	var currentText = '';
	var currentStyles = [];
	var currentTextLength = 0;

	// loop stream item creating an array of "logical lines"
	// the lines are spearated by text items with newlines (\r or \n or \r\n)
	// each line is made of a single string of text, where each character
	// represents either a real text character or an inline object (e.g. an image)
	// an additional array of "styles" has multiple objects, where each object 
	// represents either a text style run or an inline object. the "style" propery
	// will have the originla stream item. an additional "limit" property is an index that
	// represents the first characters index after this run.

	
	inItem.items.forEach(function(inItem)
	{
		if(inItem.type == 'text')
		{
			// texts may have line ends, analyse the text and finish line if necessary
			var theText = isArray(inItem.text) ? joinTextArray(inItem.text):inItem.text;
			var textComponents = theText.match(/[^\r\n]+|\r\n|\n|\r/g);
			if(textComponents)
			{
				textComponents.forEach(function(inText)
				{
					if(inText.search(/\r|\n/) == -1)
					{
						// non line. append to current text line
						currentText+=inText;
						currentTextLength+=inText.length;
						currentStyles.push({style:inItem,limit:currentTextLength});
					}
					else
					{
						// line, finalize current line and restart
						if(currentStyles.length == 0)
							currentStyles.push({style:inItem}); // for empty line make sure the maintain the style for the newline height to be calculated
						logicalLines.push({text:currentText,styles:currentStyles});
						currentText = '';
						currentStyles = [];
						currentTextLength = 0;

					}
				});
			}	
		}
		else
		{
			// non texts are simple "one character" objects
			currentText+=kDefaultInlineObjectChar;
			currentTextLength+=1;
			currentStyles.push({style:inItem,limit:currentTextLength});
		}
	});

	// close a final line if one exists
	if(currentTextLength > 0)
		logicalLines.push({text:currentText,styles:currentStyles});

	return logicalLines;
}

function composeLine(inLine,inState)
{
	if(inLine.text.length > 0)
	{

		// compose line considering various items placement and direction
		return renderParagraph(inLine,inState);
	}
	else
	{
		// empty line, just increase yOffset per the newline height.
		var lineHeight = getFont(inPDFWriter,inRenderingState,inLine.styles[0]).calculateTextDimensions('d',inLine.styles[0].options.size).yMax;
		if(inState.box.height !== undefined && inState.yOffset-lineHeight*inState.lineSpacingModifier() < inState.box.bottom)
		{
			return false;
		}
		else
		{
			inState.startLine(inState.item.direction,0,lineHeight);
			inState.reset();	
			return true;		
		}
	}
}

function renderParagraph(inLine,inState)
{
	var p = bidi.Paragraph(inLine.text,{paraLevel: inState.item.direction == 'rtl' ? bidi.RTL:bidi.LTR});

	var textLength = inLine.text.length;
	
	var paraLevel=1&p.getParaLevel();
	var direction = ((paraLevel == bidi.RTL) ? 'rtl':'ltr');
	var nonSpaceEndIndex = inLine.text.search(/[\s]*$/);
	// i'm looking to trim ending spaces, for propper alignment (centering and the opposite)
	var measures=getTextMeasures(p,inLine.text.substring(0,nonSpaceEndIndex),inLine.styles,inState);


	if(measures.width<=inState.box.width
		&& (inState.box.height == undefined || (inState.yOffset-measures.height*inState.lineSpacingModifier() >= inState.box.bottom)))
	{
		// everything fits onto one line	
		// prepare rendering a new line from either left or right
		inState.startLine(direction,measures.width,measures.height);
		renderLine(p,inLine.text,0,nonSpaceEndIndex, inLine.styles, 0,inLine.styles.length,inState);
		inState.reset();
		return true;
	}
	else
	{
		var start=0, 
			styleRunStart = 0,
			rw = {limit:null, styleRunLimit:null,width:null,height:null,verticalOverflow:false},
			skipSpaces = false; // skip spaces is for line start. any spaces should be skipped after a line that got broken

		for(;;)
		{
			rw.limit = textLength;
			rw.styleRunLimit = inLine.styles.length;
			if(skipSpaces) // only false in the first line. skip spaces in line breaks so that text start at line start.
			{
				var nonSpaceIndex = inLine.text.substr(start).search(/[^\s]/);
				if(nonSpaceIndex != -1)
				{
					start+= nonSpaceIndex;
					if(start == textLength) // if the skipped spaces are the end of the text
					{
						break;
					}
				}
			}
			rw =  getLineBreak(inLine.text,start,rw.limit,p,inLine.styles,styleRunStart,rw.styleRunLimit,inState);
			
			if(rw.verticalOverflow)
			{
				break;
			}

			var line = p.setLine(start,rw.limit);
			// prepare rendering a new line
			// from either left or right
			inState.startLine(direction,rw.width,rw.height);
			renderLine(line,inLine.text,start,rw.limit,inLine.styles,styleRunStart,rw.styleRunLimit-styleRunStart,inState);
			inState.reset();
			if(rw.limit == textLength)
			{
				break;
			}
			start = rw.limit;
			styleRunStart=rw.styleRunLimit-1;
			if(start>=inLine.styles[styleRunStart].limit)
				++styleRunStart;

			if(!skipSpaces)
				skipSpaces = true;
		}
		return rw.verticalOverflow;
	}
}

function renderLine(inBidiLine,inText,inStart,inLimit,inStyleRuns,inStyleRunsStart,inStyleRunsCount,inState)
{
	var direction = inBidiLine.getDirection();
	if(direction != 'mixed')
	{
		// unidirectional
		if(inStyleRunsCount<=1)
			inState.renderRun(inText,inStart,inLimit,direction,inStyleRuns[inStyleRunsStart].style,inState);
		else
			renderDirectionalRun(inText,inStart,inLimit,direction,inStyleRuns,inStyleRunsStart,inStyleRunsCount,inState);
	}
	else
	{
		// mixed-directional
		var count,i;

		count = inBidiLine.countRuns();
		if(inStyleRunsCount<=1)
		{
			style = inStyleRuns[inStyleRunsStart].style;
			// iterate over direcitonal runs
			for(i=0;i<count;++i)
			{
				var visRun = inBidiLine.getVisualRun(i);
				inState.renderRun(inText, inStart+visRun.logicalStart, inStart+visRun.logicalStart+visRun.length, visRun.dir, style,inState);
			}
		}
		else
		{
			for(i=0;i<count;++i)
			{
				var visRun = inBidiLine.getVisualRun(i);
				renderDirectionalRun(inText, inStart+visRun.logicalStart, inStart+visRun.logicalStart+visRun.length, visRun.dir, inStyleRuns,inStyleRunsStart,inStyleRunsCount,inState);
			}
		}
	}
}

function renderDirectionalRun(inText,inStart,inLimit,inDirection,inStyleRuns,inStyleRunsStart,inStyleRunsCount,inState)
{
	var i;

	if(inDirection == 'ltr')
	{
		var styleLimit;

		for(i=0;i<inStyleRunsCount;++i)
		{
			styleLimit = inStyleRuns[inStyleRunsStart + i].limit;
			if(inStart < styleLimit)
			{
				if(styleLimit>inLimit) { styleLimit=inLimit; }
				inState.renderRun(inText,inStart,styleLimit,inDirection,inStyleRuns[inStyleRunsStart + i].style,inState);
				if(styleLimit==inLimit) { break; }
				inStart=styleLimit;
			}
		}
	}
	else
	{
		var styleStart;

		for(i=inStyleRunsCount-1;i>=0;--i)
		{
			if(i>0)
				styleStart = inStyleRuns[inStyleRunsStart+i-1].limit;
			else
				styleStart = 0;

			if(inLimit>=styleStart)
			{
				if(styleStart<inStart) {styleStart=start;}
				inState.renderRun(inText,styleStart,inLimit,inDirection,inStyleRuns[inStyleRunsStart + i].style,inState);
				if(styleStart == start){break;}
				inLimit = styleStart;
			}
		}
	}

}

function renderRun(inText,inStart,inLimit,inDirection,inStyle,inState)
{
	var itemMeasures;
	if(inStyle.type !== undefined)
	{
		// regular item, place using regular method, with a new box stating it's position
		var theItem;
		if(inStyle.type == 'text')
		{
			theItem = shallowCopy(inStyle);
			theItem.text = inText.substring(inStart,inLimit);
		}
		else
		{
			theItem = inStyle;
		}
		theItem.direction = inDirection;
		var theBox = {left:inState.xOffset,bottom:inState.yOffset,items:[theItem]};
		renderItem(theBox,theItem,inState.renderingState.pdfPage,inState.pdfWriter,inState.renderingState);
		itemMeasures = getItemMeasures(theItem,theBox,inState.pdfWriter,inState.renderingState);
	}
	else
	{
		// a box. create a copy of the box, and replace the xOffset and yOffset
		// ponder:replacing. should i add? right now will not support non-0 coordinates
		// of box...oh well...we still have to figure out what its good for anyways
		var newBox = shallowCopy(inStyle);
		newBox.left = inState.xOffset;
		newBox.bottom = inState.yOffset;
		renderBox(newBox,inState.renderingState.pdfPage,inState.pdfWriter,inState.renderingState);
		itemMeasures = calculateBoxMeasures(newBox,inState.pdfWriter,inState.renderingState);
	}	

	inState.xOffset += itemMeasures.width;
	inState.height = Math.max(inState.height,itemMeasures.height);
}

function computeRun(inText,inStart,inLimit,inDirection,inStyle,inState)
{
	var itemMeasures;
	if(inStyle.type !== undefined)
	{
		// regular item, place using regular method, with a new box stating it's position
		var theItem;
		if(inStyle.type == 'text')
		{
			theItem = shallowCopy(inStyle);
			theItem.text = inText;
		}
		else
		{
			theItem = inStyle;
		}
		theItem.direction = inDirection;
		var theBox = {left:inState.xOffset,bottom:inState.yOffset,items:[theItem]};
		itemMeasures = getItemMeasures(theItem,theBox,inState.pdfWriter,inState.renderingState);
	}
	else
	{
		// a box. create a copy of the box, and replace the xOffset and yOffset
		// ponder:replacing. should i add? right now will not support non-0 coordinates
		// of box...oh well...we still have to figure out what its good for anyways
		var newBox = shallowCopy(inStyle);
		newBox.left = inState.xOffset;
		newBox.bottom = inState.yOffset;
		itemMeasures = calculateBoxMeasures(newBox,inState.pdfWriter,inState.renderingState);
	}	

	inState.xOffset += itemMeasures.width;
	inState.height = Math.max(inState.height,itemMeasures.width);	
}

function getLineBreak(inText,inStart,inLimit,inBidi,inStyles,inStylesStart,inStylesLimit,inState)
{
	// getlinebreak will find a line break for content so that it can be placed in a line so that it
	// fits the box width/height.
	// get line break assumes that it is placed in a constant width box.
	// therefore if it can't place anything in the line, this will mark a necessary vertical overflow.

	var maxWidth = inState.box.width;
	var result = {width:0,limit:inStart,height:0,styleRunLimit:inStylesStart};
	
	// empty case
	if(inLimit == inStart)
		return result;

	// advance styles start to an affective range
	while(inStyles[result.styleRunLimit].limit < inStart)
		++reslt.stylesLimit;

	for(;;)
	{
		// advance by logicalRun and style run, adding to width
		var logicalRun = inBidi.getLogicalRun(result.limit);

		if(logicalRun.limit > inLimit) 
			logicalRun.limit = inLimit;

		// for each style in logical run. measure as style in full
		// if good - go on [advance limit and style limit]. if not, need to break. 
		while(result.styleRunLimit < inStylesLimit && (result.styleRunLimit<1 || inStyles[result.styleRunLimit-1].limit<= logicalRun.logicalLimit))
		{
			// get the width of the range result.limit...Math.min(result.styleRunLimit,logicalRun.limit)
			var runLimit = Math.min(inStyles[result.styleRunLimit].limit,logicalRun.logicalLimit);
			var runMeasures = getRunMeasures(inText,result.limit,runLimit,logicalRun.dir,inStyles[result.styleRunLimit].style,inState);
			if((result.width + runMeasures.width <=maxWidth) &&
				(inState.box.height == undefined || (inState.yOffset-runMeasures.height*inState.lineSpacingModifier() >= inState.box.bottom)))
			{
				// add run/logical run in full
				
				result.width+=runMeasures.width;
				result.height = Math.max(runMeasures.height,result.height);
				result.limit = runLimit;
				if(runLimit == inStyles[result.styleRunLimit].limit)
					++result.styleRunLimit;
				else
					break; // logical run finish...so finish
			}
			else
			{
				// got a break, break according to spaces, and finish
				var textComponentsStart = result.limit;
				var accumulatedWidth = 0;
				var accumulatedLimitAdd = 0;
				var accumulatedLimitAddToNonSpace = 0;
				var textComponents = inText.substring(result.limit,runLimit).match(/[^\s]+|[^\S]+/g);
				for(var i=0;i<textComponents.length;++i)
				{
					runMeasures = getRunMeasures(inText,textComponentsStart,result.limit+accumulatedLimitAdd+textComponents[i].length,logicalRun.dir,inStyles[result.styleRunLimit].style,inState);
					if((result.width + runMeasures.width <=maxWidth) &&
						(inState.box.height == undefined || (inState.yOffset-runMeasures.height*inState.lineSpacingModifier() >= inState.box.bottom)))	
					{
						// add word/spaces in
						accumulatedLimitAdd+=textComponents[i].length;
						if(hasNonSpace(textComponents[i]))
						{
							accumulatedWidth=runMeasures.width; // add space to width ONLY when a later non space would show up. this should fix up the alignment problem nicely
							accumulatedLimitAddToNonSpace = accumulatedLimitAdd;
						}
						result.height = Math.max(runMeasures.height,result.height);
				
					}
					else
					{
						// add to width what accumulated so far
						break;
					}
				}
				// add accumulated width/range of what of the text that got in. take the measures so that will trim any ending spaces
				result.width+=accumulatedWidth;
				result.limit+=accumulatedLimitAddToNonSpace;
				// advance style in 1 to get to the limit
				++result.styleRunLimit;				
				// force finish
				logicalRun.logicalLimit = inLimit;
				break;
			}
		}

		if(logicalRun.logicalLimit == inLimit) // ended text, break
			break;
	}

	result.verticalOverflow = (inStart == result.limit);

	return result;
}

function getRunMeasures(inText,inStart,inLimit,inDirection,inStyle,inState)
{
	var itemMeasures;
	if(inStyle.type !== undefined)
	{
		// regular item, place using regular method, with a new box stating it's position
		var theItem;
		if(inStyle.type == 'text')
		{
			theItem = shallowCopy(inStyle);
			theItem.text = inText.substring(inStart,inLimit);
		}
		else
		{
			theItem = inStyle;
		}
		theItem.direction = inDirection;
		var theBox = {left:0,bottom:0,items:[theItem]};
		itemMeasures = getItemMeasures(theItem,theBox,inState.pdfWriter,inState.renderingState);
		if(!inState.firstLine && inStyle.type == 'text') // when not the first relevant line height is actually the font size, not the text height
			itemMeasures.height = inStyle.options.size;
	}
	else
	{
		// a box. create a copy of the box, and replace the xOffset and yOffset
		// ponder:replacing. should i add? right now will not support non-0 coordinates
		// of box...oh well...we still have to figure out what its good for anyways
		var newBox = shallowCopy(inStyle);
		newBox.left = inState.xOffset;
		newBox.bottom = inState.yOffset;
		itemMeasures = calculateBoxMeasures(newBox,inState.pdfWriter,inState.renderingState);
	}	
	return itemMeasures;
}

function getTextMeasures(p,inText, inStyles,inState)
{
	// total text width. loop through logical runs
	var width=0,limit=0,stylesLimit=0,height =0;

	while(limit<inText.length)
	{
		// advance by logicalRun and style run, adding to width
		var logicalRun = p.getLogicalRun(limit);

		while(stylesLimit<inStyles.length && (stylesLimit<1 || inStyles[stylesLimit-1].limit<= logicalRun.logicalLimit))
		{
			// get the width of the range result.limit...Math.min(result.stylesLimit,logicalRun.limit)
			var runLimit = Math.min(inStyles[stylesLimit].limit,logicalRun.logicalLimit);
			var runMeasures = getRunMeasures(inText,limit,runLimit,logicalRun.dir,inStyles[stylesLimit].style,inState);

			width+=runMeasures.width;
			height = Math.max(height,runMeasures.height);
			limit = runLimit;
			if(runLimit == inStyles[stylesLimit].limit)
				++stylesLimit;
			else
				break; // if run limit is not style limit then it is the logical run limit. meaning - time to to move the next one
		}
		limit = logicalRun.logicalLimit;
	}

	return {width:width,height:height};	
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
	return calculateBoxMeasures(inBox,inPDFWriter,inRenderingState).height;
}

function calculateBoxMeasures(inBox,inPDFWriter,inRenderingState)
{
	if(inBox.height !== undefined && inBox.width !== undefined)
		return {width:inBox.width,height:inBox.height};
	else
	{
		var itemsMeasures;

		if(inBox.items)
		{
			itemsMeasures = {width:0,height:0};
			inBox.items.forEach(function(inItem)
			{
				var itemMeasures = getItemMeasures(inItem,inBox,inPDFWriter,inRenderingState);
				itemsMeasures.height = Math.max(itemMeasures.height,itemsMeasures.height);
				itemsMeasures.width+=itemMeasures.width;

			});

		}
		else if(inBox.image)
			itemsMeasures =  getImageItemMeasures(inBox.image,inPDFWriter,inRenderingState,inBox);
		else if(inBox.shape)
		 	itemsMeasures = getShapeItemMeasures(inBox.shape,inPDFWriter,inRenderingState);
		else if(inBox.text)
			itemsMeasures = getTextItemMeasures(inBox.text,inPDFWriter,inRenderingState);
		else if(inBox.stream)
			itemsMeasures = getComosedStreamMeasures(inBox,inBox.stream,inPDFWriter,inRenderingState);

		return {width:inBox.width === undefined ? itemsMeasures.width:inBox.width,
				height:inBox.height === undefined ? itemsMeasures.height:inBox.height};
	}
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
	// note that below, any derivation of the transformation width/height from the box width/height should have already happened

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
			result = {width:inItem.transformation.width,
						height:inItem.transformation.height};
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
		composeStreamItem(inBox,inItem,inPDFWriter,inRenderingState,computeRun);

	return {bottom:inItem.lowestContentOffset,height:inItem.contentHeight};
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