const TEXCACHEROOT = "/tex";
const WORKROOT = "/work";
var Module = {};
self.memlog = "";
self.initmem = undefined;
self.mainfile = "main.tex";

Module['print'] = function(a) {
    self.memlog += (a + "\n");
};

Module['printErr'] = function(a) {
    self.memlog += (a + "\n");
    console.log(a);
};

Module['preRun'] = function() {
    FS.mkdir(TEXCACHEROOT);
    FS.mkdir(WORKROOT);
};

function dumpHeapMemory() {
    var src = wasmMemory.buffer;
    var dst = new Uint8Array(src.byteLength);
    dst.set(new Uint8Array(src));
    // console.log("Dumping " + src.byteLength);
    return dst;
}

function restoreHeapMemory() {
    if (self.initmem) {
        var dst = new Uint8Array(wasmMemory.buffer);
        dst.set(self.initmem);
    }
}

function closeFSStreams() {
    for (var i = 0; i < FS.streams.length; i++) {
        var stream = FS.streams[i];
        if (!stream || stream.fd <= 2) {
            continue;
        }
        FS.close(stream);
    }
}

function prepareExecutionContext() {
    self.memlog = '';
    restoreHeapMemory();
    closeFSStreams();
    FS.chdir(WORKROOT);
}

Module['postRun'] = function() {
    self.postMessage({
        'result': 'ok',
    });
    self.initmem = dumpHeapMemory();
};

function cleanDir(dir) {
    let l = FS.readdir(dir);
    for (let i in l) {
        let item = l[i];
        if (item === "." || item === "..") {
            continue;
        }
        item = dir + "/" + item;
        let fsStat = undefined;
        try {
            fsStat = FS.stat(item);
        } catch (err) {
            console.error("Not able to fsstat " + item);
            continue;
        }
        if (FS.isDir(fsStat.mode)) {
            cleanDir(item);
        } else {
            try {
                FS.unlink(item);
            } catch (err) {
                console.error("Not able to unlink " + item);
            }
        }
    }

    if (dir !== WORKROOT) {
        try {
            FS.rmdir(dir);
        } catch (err) {
            console.error("Not able to top level " + dir);
        }
    }
}



Module['onAbort'] = function() {
    self.memlog += 'Engine crashed';
    self.postMessage({
        'result': 'failed',
        'status': -254,
        'log': self.memlog,
        'cmd': 'compile'
    });
    return;
};

function compileLaTeXRoutine(desiredDVI) {
    prepareExecutionContext();
    const setMainFunction = cwrap('setMainEntry', 'number', ['string']);
    setMainFunction(self.mainfile);
    self.dviMode = desiredDVI;
    let status = _compileLaTeX(desiredDVI);
    if (status === 0) {
        let pdfArrayBuffer = null;
        _compileBibtex();
        let pdfurl = WORKROOT + "/" + self.mainfile.substr(0, self.mainfile.length - 4) + (desiredDVI ? ".xdv" : ".html");
        try {
            pdfArrayBuffer = FS.readFile(pdfurl, {
                encoding: 'binary'
            });
        } catch (err) {
            console.error("Fetch content failed. " + pdfurl);
            status = -253;
            self.postMessage({
                'result': 'failed',
                'status': status,
                'log': self.memlog,
                'cmd': 'compile'
            });
            return;
        }
        self.postMessage({
            'result': 'ok',
            'status': status,
            'log': self.memlog,
            'pdf': pdfArrayBuffer.buffer,
            'cmd': 'compile'
        }, [pdfArrayBuffer.buffer]);
    } else {
        console.error("Compilation failed, with status code " + status);
        self.postMessage({
            'result': 'failed',
            'status': status,
            'log': self.memlog,
            'cmd': 'compile'
        });
    }
}

function compileFormatRoutine() {
    prepareExecutionContext();
    let status = _compileFormat();
    if (status === 0) {
        let pdfArrayBuffer = null;
        try {
            let pdfurl = WORKROOT + "/xelatex.fmt";
            pdfArrayBuffer = FS.readFile(pdfurl, {
                encoding: 'binary'
            });
        } catch (err) {
            console.error("Fetch content failed.");
            status = -253;
            self.postMessage({
                'result': 'failed',
                'status': status,
                'log': self.memlog,
                'cmd': 'compile'
            });
            return;
        }
        self.postMessage({
            'result': 'ok',
            'status': status,
            'log': self.memlog,
            'pdf': pdfArrayBuffer.buffer,
            'cmd': 'compile'
        }, [pdfArrayBuffer.buffer]);
    } else {
        console.error("Compilation format failed, with status code " + status);
        self.postMessage({
            'result': 'failed',
            'status': status,
            'log': self.memlog,
            'cmd': 'compile'
        });
    }
}

function mkdirRoutine(dirname) {
    try {
        //console.log("removing " + item);
        FS.mkdir(WORKROOT + "/" + dirname);
        self.postMessage({
            'result': 'ok',
            'cmd': 'mkdir'
        });
    } catch (err) {
        console.error("Not able to mkdir " + dirname);
        self.postMessage({
            'result': 'failed',
            'cmd': 'mkdir'
        });
    }
}

function writeFileRoutine(filename, content) {
    try {
        FS.writeFile(WORKROOT + "/" + filename, content);
        self.postMessage({
            'result': 'ok',
            'cmd': 'writefile'
        });
    } catch (err) {
        console.error("Unable to write mem file");
        self.postMessage({
            'result': 'failed',
            'cmd': 'writefile'
        });
    }
}

self['onmessage'] = function(ev) {
    let data = ev['data'];
    let cmd = data['cmd'];
    if (cmd === 'compilelatex') {
    	const desiredDVI = data['dvi'] ? 1 : 0;
    	compileLaTeXRoutine(desiredDVI);
    } else if (cmd === 'compileformat') {
        compileFormatRoutine();
    } else if (cmd === "mkdir") {
        mkdirRoutine(data['url']);
    } else if (cmd === "writefile") {
        writeFileRoutine(data['url'], data['src']);
    } else if (cmd === "setmainfile") {
        self.mainfile = data['url'];
    } else if (cmd === "grace") {
        console.error("Gracefully Close");
        self.close();
    } else if (cmd === "flushcache") {
        cleanDir(WORKROOT);
    } else {
        console.error("Unknown command " + cmd);
    }
};

let texlive404_cache = {};
let texlive200_cache = {};
// const formatFilters = [".ai", ".jp2", ".jpf", ".ps", ".eps", "mps", ".pz", ".z", ".gz",
//  ".log", ".aux", ".toc", ".bbl", ".jpg", ".pdf", ".bmp", ".bb", ".png"];

function kpse_fetch_from_network_impl(nameptr, format) {

    const reqname = UTF8ToString(nameptr);

    if (reqname.includes("/")) {
        return -1;
    }

    // for (let i = 0; i < formatFilters.length; i++) {
    //     if (reqname.toLowerCase().endsWith(formatFilters[i])) {
    //         return -1;
    //     }
    // }

    const cacheKey = reqname;

    if (cacheKey in texlive200_cache) {
        return 0;
    }
    
    if (cacheKey in texlive404_cache) {
        return -1;
    }

    //self.postMessage({'result':'ok', 'type':'status', 'cmd':'texlivefetch', 'data':reqname});
    const remote_endpoint = "https://texlive.swiftlatex.com/";
    const remote_url = remote_endpoint + cacheKey;
    let xhr = new XMLHttpRequest();
    xhr.open("GET", remote_url, false);
    xhr.timeout = 150000;
    xhr.responseType = "arraybuffer";
    console.log("Start downloading texlive file " + remote_url);
    try {
        xhr.send();
    } catch (err) {
        console.log("TexLive Download Failed " + remote_url);
        return -1;
    }

    if (xhr.status === 200) {
        let arraybuffer = xhr.response;
        //console.log(arraybuffer);
        FS.writeFile(TEXCACHEROOT + "/" + cacheKey, new Uint8Array(arraybuffer));
        texlive200_cache[cacheKey] = 1;
        return 0;
    } else if (xhr.status === 301 || xhr.status === 404) {
        console.log("TexLive File not exists " + remote_url);
        texlive404_cache[cacheKey] = 1;
        return -1;
    }
    return -1;
}


let fontconfig_200cache = {};
let fontconfig_404cache = {};
function fontconfig_search_font_impl(fontnamePtr, varStringPtr) {
    const fontname = UTF8ToString(fontnamePtr);
    let variant = UTF8ToString(varStringPtr);
    if (!variant) {
        variant = 'OT';
    }
    variant = variant.replace(/\//g, '_');

    const cacheKey = variant + '/' + fontname;
    
    if (cacheKey in texlive200_cache) {
        const savepath = texlive200_cache[cacheKey];
        return allocate(intArrayFromString(savepath), 'i8', ALLOC_NORMAL);
    }
    
    if (cacheKey in texlive404_cache) {
        return 0;
    }

    const remote_endpoint = "https://texlive.swiftlatex.com/fontconfig/";
    const remote_url = remote_endpoint + cacheKey;
    let xhr = new XMLHttpRequest();
    xhr.open("GET", remote_url, false);
    xhr.timeout = 150000;
    xhr.responseType = "arraybuffer";
    console.log("Start downloading texlive file " + remote_url);
    try {
        xhr.send();
    } catch (err) {
        console.log("TexLive Download Failed " + remote_url);
        return 0;
    }
    if (xhr.status === 200) {
        let arraybuffer = xhr.response;
        const fontID = xhr.getResponseHeader('fontid');
        const savepath = TEXCACHEROOT + "/" + fontID;

        FS.writeFile(savepath, new Uint8Array(arraybuffer));
        texlive200_cache[cacheKey] = savepath;
        return allocate(intArrayFromString(savepath), 'i8', ALLOC_NORMAL);

    } else if (xhr.status === 301 || xhr.status === 404) {
        console.log("TexLive File not exists " + remote_url);
        texlive404_cache[cacheKey] = 1;
        return 0;
    }
    
    return 0;
}