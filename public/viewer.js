let totalPage = 1;
let currentPage = 1;
let zoomRatio = 1;
let cachedFileList = [];
let batchingQueue = [];
let resourcesMap = {};
let isBatching = false;
let bufferedDocument = undefined;
let cursorAttachElement = undefined;
let lastKnownCursorPosition = undefined;

function _removeExtension(filename) {
    const lastDotPosition = filename.lastIndexOf('.');
    if (lastDotPosition === -1) return filename;
    else return filename.substr(0, lastDotPosition);
}

function _baseName(str) {
    let base = new String(str).substring(str.lastIndexOf('/') + 1);
    if (base.lastIndexOf('.') != -1)
        base = base.substring(0, base.lastIndexOf('.'));
    return base;
}

function _lookupResources(path) {
    if (path.startsWith('./')) {
        path = path.slice(2);
    }
    if (path in resourcesMap) {
        return resourcesMap[path];
    }
    return undefined;
}

function loadFonts() {
    let newFontData = '';
    bufferedDocument.find('fontdef').each(function(i, child) {
        const fonttype = child.getAttribute('fonttype');
        const fonturl = child.getAttribute('fonturl');
        const fontsize = child.getAttribute('fontsize');
        const fontbase = _removeExtension(_baseName(fonturl));
        const fontid = child.getAttribute('fontid');
        if (fonttype === 'native') {
            if (fonturl.startsWith('/tex/')) {
                const astyle = `<style>@font-face {font-family:${fontbase}; src:url(https://texlive.swiftlatex.com/${fontbase}.otf);} .ff${fontid} {font-family: ${fontbase}; font-size:${fontsize}px}</style>\n`;
                newFontData += astyle;
            } else {
                const remoteUrl = _lookupResources(fonturl);
                if (!remoteUrl) {
                    console.error('Unable to locate user font');
                } else {
                    const astyle = `<style>@font-face {font-family:${fontbase}; src:url(${remoteUrl});} .ff${fontid} {font-family: ${fontbase}; font-size:${fontsize}px}</style>\n`;
                    newFontData += astyle;
                }
            }
        } else {
            const astyle = `<style>@font-face {font-family:${fontbase}; src:url(https://texlive.swiftlatex.com/fonts/${fontbase}.woff);} .ff${fontid} {font-family: ${fontbase}; font-size:${fontsize}px}</style>\n`;
            newFontData += astyle;
        }
    });
    const originFontData = d3.select('#fontLoader').html();
    if (newFontData !== originFontData) {
        d3.select('#fontLoader').html(newFontData);
    }
}

function loadFileLists() {
    cachedFileList = [];
    bufferedDocument.find('file').each(function(i, child) {
        const fid = parseInt(child.getAttribute('fid')) + 1;
        let path = child.getAttribute('url');
        if (path.startsWith('./')) {
            path = path.slice(2);
        }
        cachedFileList.push([fid, path]);
    });
}

function replayBatchingQueue() {
    for (let j = 0; j < batchingQueue.length; j++) {
        let tmp = batchingQueue[j];
        let data = tmp.data;
        let cmdType = tmp.type;
        if (cmdType === 'setCursor') {
            showCursor(data['path'], data['line'], data['column']);
        } else if (cmdType === 'typeContent') {
            if (data['isInsert']) {
                appendCharacter(data['delta']);
            } else {
                deleteCharacter(data['delta']);
            }
        }
    }
    batchingQueue = [];
    isBatching = false;
}

function showPage() {
    if (!bufferedDocument) return;
    cursorAttachElement = undefined;
    /* Update Input Field */
    totalPage = bufferedDocument.find('page').length;
    if (currentPage > totalPage) {
        currentPage = totalPage;
    }
    d3.select('#toolbar-input').property('value', `${currentPage}/${totalPage}`);

    /* File List */
    loadFileLists();

    /* Font */
    loadFonts();

    /* HTML and click, pic hover event */
    const htmldata = bufferedDocument.find('page').eq(currentPage - 1).text();
    d3.select('#viewer').html(htmldata);
    bindClickEvent();
    bindPicHoverEvent();

    /* Replay Event */
    if (batchingQueue.length > 0) {
        /* Replay batching queue */
        replayBatchingQueue();
    } else {
        if (lastKnownCursorPosition) {
            showCursor(lastKnownCursorPosition.path, lastKnownCursorPosition.line, lastKnownCursorPosition.column);
        }
    }
}

function bindPicHoverEvent() {
    d3.selectAll('.userPic').on('mouseover', _ => {
        const target = d3.event.target;
        if (target.hasAttribute('loaded')) return;
        target.setAttribute('loaded', '1');
        if (!target.hasAttribute('url')) return;
        const url = target.getAttribute('url');
        const remoteUrl = _lookupResources(url);
        if (!remoteUrl) return;
        // console.log(remoteUrl);
        if (remoteUrl.endsWith('pdf')) {

        } else {
            target.setAttribute('href', remoteUrl);
        }
    });
}

function bindClickEvent() {
    d3.selectAll('tspan').on('click', e => {
        const tspan = d3.event.target;
        if (tspan.hasAttribute('l')) {

            const line = parseInt(tspan.getAttribute('l'));
            const column = parseInt(tspan.getAttribute('c'));
            const fileID = parseInt(tspan.getAttribute('f'));
            const path = fidToPath(fileID);
            const command = tspan.getAttribute('t');
            if (line > 0 && path.length > 0) {
                const msg = {
                    cmd: 'setCursor',
                    line: line,
                    column: column,
                    path: path,
                    command: command,
                };
                if (window.top) {
                    window.top.postMessage(
                      msg,
                      '*',
                    );
                }
                if (window.opener) {
                    window.opener.postMessage(
                      msg,
                      '*',
                    );
                    window.open('', 'parent-window').focus();
                }

            }
        }
    });
}

function handleNextPage() {
    if (currentPage + 1 <= totalPage) {
        currentPage += 1;
        showPage();
    }
}

function handlePrevPage() {
    if (currentPage - 1 >= 1) {
        currentPage -= 1;
        showPage();
    }
}

function handleZoomin() {
    console.log('Zoom in');
    zoomRatio += 0.1;
    doZoom();
}

function doZoom() {
    const viewer = d3.select('#viewer');
    viewer.style('transform', `scale(${zoomRatio})`);
}

function handleZoomOut() {
    console.log('Zoom Out');
    if (zoomRatio >= 0.1) {
        zoomRatio -= 0.1;
        doZoom();
    }
}

function handleInputChanged() {
    if (!bufferedDocument) {
        return;
    }

    const input_ui = d3.select('#toolbar-input');
    let input_val = input_ui.property('value');
    if (input_val.includes('/')) {
        input_val = input_val.split('/')[0];
    }
    const vv = parseInt(input_val);
    if (!isNaN(vv)) {
        if ((vv >= 1 && vv <= totalPage) && vv !== currentPage) {
            currentPage = vv;
            showPage();
            return;
        }
    }

    input_ui.property('value', `${currentPage}/${totalPage}`);

}

function receiveMessage(event) {
    const data = event['data'];
    const cmd = data['cmd'];
    if (cmd === 'setContent') {
        const rawMeat = data['source'];
        resourcesMap = data['resources'];
        bufferedDocument = $($.parseXML(rawMeat));
        showPage();
    } else if (cmd === 'setCursor') {
        lastKnownCursorPosition = data;
        let res = showCursor(data['path'], data['line'], data['column']);
        if (isBatching) {
            if (res) {
                batchingQueue.push({ 'type': 'setCursor', 'data': data });
            } else {
                isBatching = false; /* Give Up */
                batchingQueue = [];
                console.error('SetCursor return false, stop batching');
            }
        }
    } else if (cmd === 'typeContent') {
        let res = false;
        if (data['isInsert']) {
            res = appendCharacter(data['delta']);
        } else {
            res = deleteCharacter(data['delta']);
        }
        if (isBatching) {
            if (res) {
                batchingQueue.push({ 'type': 'typeContent', 'data': data });
            } else {
                isBatching = false; /* Give Up */
                batchingQueue = [];
                console.error('TypeContent return false, stop batching');
            }
        }
    } else if (cmd === 'compileStart') {
        if (cursorAttachElement) { /* Not necessary to batch */
            batchingQueue.push({ 'type': 'setCursor', 'data': lastKnownCursorPosition });
            isBatching = true;
        }
    } else if (cmd === 'compileEnd') {
        isBatching = false;
    } else if (cmd === 'compileError') {
        /* Todo */
    }
}

function pathToFid(path) {
    for (let j = 0; j < cachedFileList.length; j++) {
        let tmp = cachedFileList[j];
        if (tmp[1] === path) {
            return tmp[0];
        }
    }
    return 0;
}

function fidToPath(fid) {
    for (let j = 0; j < cachedFileList.length; j++) {
        let tmp = cachedFileList[j];
        if (tmp[0] === fid) {
            return tmp[1];
        }
    }
    return '';
}


function showCursor(path, line, column) {
    if (!bufferedDocument) {
        return false;
    }

    /* Clean up */
    d3.select('.cursor').remove();
    d3.select('.fuzzyspan').remove();
    cursorAttachElement = undefined;

    /* Start looking up */
    let fuzzyCursorEnabled = false;
    let fuzzySpace = false;
    let fid = pathToFid(path);
    if (fid === 0) {
        return false;
    }

    let lineFilter = d3.selectAll(`tspan[l="${line}"]`).filter(`tspan[f="${fid}"]`);
    let r = lineFilter.filter(`tspan[c="${column}"]`);
    if (r.empty()) {
        if (column <= 1) { /* No hope */
            return;
        }

        /* Fuzzy logic, try to locate prev text span */
        let tryAttempt = 5;
        let i = 1;
        for (; i < tryAttempt; i++) {
            const potentialColumn = column - i;
            if (potentialColumn < 1) break;
            r = lineFilter.filter(`tspan[c="${potentialColumn}"]`);
            if (!r.empty()) {
                column = potentialColumn + 1;
                fuzzyCursorEnabled = true;
                if (i > 1) fuzzySpace = true;
                break;
            }
        }
        /* Only fuzzy cursor survive */
        if (!fuzzyCursorEnabled) return;
    }

    cursorAttachElement = r.node();
    const bbox = cursorAttachElement.getBBox();
    let bbox_x = bbox.x;
    const parentTag = cursorAttachElement.parentNode; /* for locating baseline */
    let bbox_y = parentTag.getAttribute('y') - 10;
    if (fuzzyCursorEnabled) {
        bbox_x = bbox.x + bbox.width;
        if (fuzzySpace) bbox_x += bbox.width; /* add one more */
        /* We create a dummy text tag */
        const newTspanTag = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        newTspanTag.setAttribute('c', column);
        newTspanTag.setAttribute('l', line);
        newTspanTag.setAttribute('f', fid);
        newTspanTag.setAttribute('t', 0);
        newTspanTag.setAttribute('class', 'fuzzyspan');
        newTspanTag.textContent = '_';
        if (fuzzySpace) newTspanTag.textContent += '_'; /* add one more */
        parentTag.insertBefore(newTspanTag, cursorAttachElement.nextSibling);
        cursorAttachElement = newTspanTag;
    }
    d3.select('svg').append('rect').attr('x', bbox_x).attr('y', bbox_y).attr('width', 1).attr('height', 10).attr('class', 'cursor').attr('fill', 'red').attr('fill', 'red');
    return true;
}

function appendCharacter(character) {
    if (!bufferedDocument) {
        return false;
    }
    if (!cursorAttachElement) {
        return false;
    }
    let column = parseInt(cursorAttachElement.getAttribute('c'));
    let line = parseInt(cursorAttachElement.getAttribute('l'));
    let fid = parseInt(cursorAttachElement.getAttribute('f'));
    let textTag = cursorAttachElement.parentNode;
    const newTspanTag = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
    newTspanTag.setAttribute('c', column);
    newTspanTag.setAttribute('l', line);
    newTspanTag.setAttribute('f', fid);
    newTspanTag.setAttribute('t', 0);
    newTspanTag.textContent = character;
    textTag.insertBefore(newTspanTag, cursorAttachElement);

    let updateColumns = d3.selectAll(`tspan[l="${line}"]`).filter(`tspan[f="${fid}"]`);
    updateColumns.each(function(d) {
        if (this === newTspanTag) return;
        const originalColumn = parseInt(this.getAttribute('c'));
        if (originalColumn >= column) {
            this.setAttribute('c', originalColumn + 1);
        }
    });

    /* Measure the newly inserted width */
    const width = newTspanTag.getBBox().width;
    const baseline = textTag.getAttribute('y');
    let j = 0;
    let tmp1 = textTag.nextElementSibling;
    while (tmp1 && j < 128) {
        j++;
        const originalBaseline = tmp1.getAttribute('y');
        if (originalBaseline !== baseline) {
            break;
        }
        const originalX = parseInt(tmp1.getAttribute('x'));
        tmp1.setAttribute('x', originalX + width);
        tmp1 = tmp1.nextElementSibling;
    }

    /* Update the position of the text span in the same row */
    d3.select('.cursor').remove();
    cursorAttachElement = undefined;
    return true;
}

function deleteCharacter(character) {
    if (!bufferedDocument) {
        return false;
    }
    if (!cursorAttachElement) {
        return false;
    }
    let column = parseInt(cursorAttachElement.getAttribute('c'));
    let line = parseInt(cursorAttachElement.getAttribute('l'));
    let fid = parseInt(cursorAttachElement.getAttribute('f'));
    let prevSib = cursorAttachElement.previousElementSibling;
    if (!prevSib) {
        // console.error("Attempt to find ");
        /* We need to check previous text span*/
        const parentTextTag = cursorAttachElement.parentNode;
        const prevParentTextTag = parentTextTag.previousElementSibling;
        if (!prevParentTextTag) {
            // console.error("No prev text");
            return false;
        }
        const lastTspan = prevParentTextTag.lastElementChild;
        if (!lastTspan) {
            // console.error("No last tspan");
            return false;
        }
        /* We need them to be on the same line */
        let lastTspanColumn = parseInt(lastTspan.getAttribute('c'));
        let lastTspanLine = parseInt(lastTspan.getAttribute('l'));
        if (lastTspanLine === line && lastTspanColumn + 1 === column) {
            prevSib = lastTspan;
        } else {
            // console.log(lastTspanLine + ' ' + line + ' ' + lastTspanColumn + ' ' + column);
            // console.error("Here failed");
            return false;
        }
    }

    const prevParentTag = prevSib.parentNode;
    if (prevSib.textContent !== character) {
        return false;
    }

    /* Update Column */
    let updateColumns = d3.selectAll(`tspan[l="${line}"]`).filter(`tspan[f="${fid}"]`);
    updateColumns.each(function(d) {
        const originalColumn = parseInt(this.getAttribute('c'));
        if (originalColumn >= column) {
            this.setAttribute('c', originalColumn - 1);
        }
    });

    /* Measure the newly deleted width */
    const width = prevSib.getBBox().width;
    const baseline = prevParentTag.getAttribute('y');
    let tmp1 = prevParentTag.nextElementSibling;
    let j = 0;
    while (tmp1 && j < 128) {
        j++;
        const originalBaseline = tmp1.getAttribute('y');
        if (originalBaseline !== baseline) {
            break;
        }
        const originalX = parseInt(tmp1.getAttribute('x'));
        tmp1.setAttribute('x', originalX - width);
        tmp1 = tmp1.nextElementSibling;
    }

    /* Clean up */
    d3.select(prevSib).remove();
    if (prevParentTag.childElementCount === 0) {
        d3.select(prevParentTag).remove();
    }

    d3.select('.cursor').remove();
    cursorAttachElement = undefined;
    return true;
}


window.addEventListener('message', receiveMessage, false);
d3.select('#toolbar-next').on('click', handleNextPage);
d3.select('#toolbar-previous').on('click', handlePrevPage);
d3.select('#toolbar-zoomin').on('click', handleZoomin);
d3.select('#toolbar-zoomout').on('click', handleZoomOut);
d3.select('#toolbar-input').on('change', handleInputChanged);