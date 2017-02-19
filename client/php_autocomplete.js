(function($,ui){

function monacoReady(cb) {
    if (window.monaco) return cb();
    dayside.editor.bind("editorCreated",function(b,e){ if (cb) cb(); cb = false; });
}

function convertRange(range) {
    return {
        startLineNumber: range.start.line + 1,
        startColumn: range.start.character + 1,
        endLineNumber: range.end.line + 1,
        endColumn: range.end.character + 1
    }
}

dayside.php_autocomplete = dayside.plugins.php_autocomplete = $.Class.extend({
    init: function (o) {
        var me = this;
        this.options = $.extend({
            port: 8000,
            wss_port: 8443
        },o);
        this.Class.instance = this;

        dayside.core.bind("configDefaults",function(b,e){
            e.value.php_autocomplete_enable = false;
        });

        dayside.core.bind("configUpdate",function(b,e){
            if (e.value.php_autocomplete_enable) {
                if (!me.connected) me.connect();
            } else {
                if (me.connected) me.disconnect();
            }
        });

        dayside.core.bind("configTabsCreated",function(b,e){
            var configTab = teacss.ui.panel({
                label: "Autocomplete", padding: "1em"
            }).push(
                ui.check({ label: "PHP enabled", name: "php_autocomplete_enable", width: "100%", margin: "5px 0" })
            );
            e.tabs.addTab(configTab);
        });    

        dayside.ready(function(){
            dayside.editor.bind("editorOptions",function(b,e){
                e.options.overrideOptions = e.options.overrideOptions || {};
                e.options.overrideOptions.editorService = {
                    openEditor: function (e) {
                        return new monaco.Promise(function(complete,error){
                            var url = me.getUrl(e.resource);
                            var selection = e.options.selection;

                            var tab = dayside.editor.selectFile(url);

                            function positionCursor() {
                                var editor = tab.editor;
                                if (selection) {
                                    if (typeof selection.endLineNumber === 'number' && typeof selection.endColumn === 'number') {
                                        editor.setSelection(selection);
                                        editor.revealRangeInCenter(selection);
                                    } else {
                                        var pos = {
                                            lineNumber: selection.startLineNumber,
                                            column: selection.startColumn
                                        };
                                        editor.setPosition(pos);
                                        editor.revealPositionInCenter(pos);                            
                                    }
                                }

                                if (!editor.getControl) {
                                    editor.getControl = function () {
                                        return this;
                                    }
                                }
                                tab.saveState();
                                complete(editor);
                            }
                            
                            if (tab.editor) {
                                positionCursor();
                            } else {
                                tab.bind("editorCreated",positionCursor);
                            }
                        });
                    }
                }
            });
        });
    },

    disconnect: function () {
        this.socket.close();
    },

    connect: function () {
        var me = this;
        if (!me.root) {
            dayside.ready(function(){
                FileApi.request('real_path',{path:FileApi.root},true,function(res){
                    me.root = res.data.path.replace(/\/$/, "");
                    me.rootUrl = dayside.options.root.replace(/\/$/, "");
                    console.debug('ROOT',me.root);
                    me.connect();
                });
            }); 
            return;
        }
        me.createSocket();
    },

    createSocket: function() {
        var me = this;
        var url;

        if (window.location.protocol === 'https:') {
            url = "wss://" + window.location.hostname + ":" + me.options.wss_port;
        } else {
            url = "ws://" + window.location.hostname + ":" + me.options.port;
        }

        var socket = this.socket = new WebSocket(url);
        socket.onopen = function () { 
            console.log("Connection OK");
            me.connected = true;
            me.onConnected();
        };
        socket.onclose = function (event) {
            if (event.wasClean) {
                console.log('Closed clean');
            } else {
                console.log('Broken connection');
            }
            console.log('Code: ' + event.code + ' reason: ' + event.reason);
            me.connected = false;
        };

        socket.onmessage = function (event) {
            var parts = event.data.split("\n");
            var data = JSON.parse(parts[parts.length-1]);
            me.receive(data);
        };

        socket.onerror = function (error) {
            console.log("Error " + error.message);
            me.startServer(function(){            
                me.createSocket();
            });
        };
    },

    onConnected: function () {
        var me = this;
        this.send("initialize",{
            rootPath: me.root,
            capabilities: {}                
        },function(msg){
            var serverCapabilities = msg.result.capabilities;
            
            if (me.providersRegistered) return;
            me.providersRegistered = true;
            monacoReady(function(){
                if (serverCapabilities.completionProvider) {
                    monaco.languages.registerCompletionItemProvider('php', {
                        triggerCharacters: serverCapabilities.completionProvider.triggerCharacters,
                        provideCompletionItems: function(model, position) {
                            if (!me.connected) return [];
                            return new monaco.Promise(function(complete){
                                if (model.codeTab.changeCallback) model.codeTab.changeCallback();
                                me.send('textDocument/completion',{
                                    position: {
                                        line: position.lineNumber - 1,
                                        character: position.column - 1
                                    },
                                    textDocument: {
                                        uri: me.getModelUri(model)
                                    }
                                },function(msg){
                                    msg.result.items.forEach(function(item){
                                        if (item.insertText==null) delete item['insertText'];
                                    });
                                    complete(msg.result);
                                });                        
                            });
                        }
                    });
                }

                if (serverCapabilities.hoverProvider) {
                    monaco.languages.registerHoverProvider('php', {
                        provideHover: function(model, position) {
                            if (!me.connected) return [];
                            return new monaco.Promise(function(complete){
                                if (model.codeTab.changeCallback) model.codeTab.changeCallback();
                                me.send('textDocument/hover',{
                                    position: {
                                        line: position.lineNumber - 1,
                                        character: position.column - 1
                                    },
                                    textDocument: {
                                        uri: me.getModelUri(model)
                                    }
                                },function(msg){
                                    complete(msg.result);
                                });                        
                            });
                        }
                    });
                }

                if (serverCapabilities.definitionProvider) {
                    monaco.languages.registerDefinitionProvider('php',{
                        provideDefinition: function(model,position) {
                            if (!me.connected) return [];
                            return new monaco.Promise(function(complete){
                                if (model.codeTab.changeCallback) model.codeTab.changeCallback();
                                me.send('textDocument/definition',{
                                    position: {
                                        line: position.lineNumber - 1,
                                        character: position.column - 1
                                    },
                                    textDocument: {
                                        uri: me.getModelUri(model)
                                    }
                                },function(msg){
                                    if (msg.result.range) {
                                        msg.result.range = convertRange(msg.result.range);
                                    } else {
                                        msg.result.forEach(function(one){
                                            one.range = convertRange(one.range);
                                        });
                                    }
                                    complete(msg.result);
                                });                        
                            });
                        }
                    });
                }

                if (serverCapabilities.documentSymbolProvider) {
                    monaco.languages.registerDocumentSymbolProvider('php',{
                        provideDocumentSymbols: function(model) {
                            if (!me.connected) return [];
                            return new monaco.Promise(function(complete){
                                me.send('textDocument/documentSymbol',{
                                    textDocument: {
                                        uri: me.getModelUri(model)
                                    }                                
                                },function(msg){
                                    msg.result.forEach(function(symbol){
                                        symbol.location.range = convertRange(symbol.location.range);
                                    });
                                    complete(msg.result);
                                });
                            });
                        }
                    });
                }

                if (serverCapabilities.referencesProvider) {
                    monaco.languages.registerReferenceProvider('php',{
                        provideReferences: function(model,position,context) {
                            if (!me.connected) return [];
                            return new monaco.Promise(function(complete){
                                me.send('textDocument/references',{
                                    context: context,
                                    position: {
                                        line: position.lineNumber - 1,
                                        character: position.column - 1
                                    },                                    
                                    textDocument: {
                                        uri: me.getModelUri(model)
                                    }                                
                                },function(msg){
                                    msg.result.forEach(function(ref){
                                        ref.range = convertRange(ref.range);
                                    });                                    
                                    complete(msg.result);
                                });
                            });
                        }
                    });
                }                

            });

            function registerTab(tab) {
                tab.editor.model.codeTab = tab;
                me.send("textDocument/didOpen",{
                    textDocument: {
                        uri: me.getModelUri(tab.editor.getModel()),
                        languageId: 'php',
                        version: tab.editor.getModel().getVersionId(),
                        text: tab.editor.getValue()
                    }
                });
                tab.bind("close",function(b,event_close){
                    if (!event_close.cancel) {
                        if (tab.changeCallback) tab.changeCallback();
                        me.send("textDocument/didClose",{
                            textDocument: {
                                uri: me.getModelUri(tab.editor.getModel())
                            }   
                        });
                    }
                });            
            }

            ui.codeTab.tabs.forEach(function(tab){
                if (tab.editor) registerTab(tab);
            });
            dayside.editor.bind("editorCreated",function(b,e){
                registerTab(e.tab);
            });
            dayside.editor.bind("codeChanged",function(b,tab){
                clearTimeout(tab.autocompleteDidChangeTimeout);
                tab.changeCallback = function(){
                    tab.changeCallback = false;
                    clearTimeout(tab.autocompleteDidChangeTimeout);
                    me.send("textDocument/didChange",{
                        textDocument: {
                            uri: me.getModelUri(tab.editor.getModel()),
                            version: tab.editor.getModel().getVersionId()
                        },
                        contentChanges: [{
                            text: tab.editor.getValue()
                        }]
                    });
                }
                tab.autocompleteDidChangeTimeout = setTimeout(tab.changeCallback,2000);
            });
        });
    },
    getModelUri: function (model) {
        return this.getUri(model.codeTab.options.file);
    },
    getUri: function (url) {
        return "file://"+url.replace(this.rootUrl,this.root);
    },
    getUrl: function (uri) {
        return uri.replace(/^file:\/\//,"").replace(this.root,this.rootUrl);
    },
    sendCallbacks: {},
    send: function (method,params,callback) {
        var me = this;  
        me.requestId = (me.requestId || 0) + 1;
        var msg = {
            id: me.requestId,
            method: method,
            params: params
        }
        console.log("SENT",msg);
        this.socket.send(JSON.stringify(msg));

        if (callback) me.sendCallbacks[me.requestId] = callback;
        return me.requestId;
    },

    receive: function (msg) {
        var me = this;
        console.log("RECV",msg);
        if (msg.id && me.sendCallbacks[msg.id]) {
            me.sendCallbacks[msg.id](msg);
            delete me.sendCallbacks[msg.id];
        }
    },

    startServer: function (cb) {
        var me = this;
        if (me.serverStarted) {
            console.debug('First start server was not successful');
            return;
        }
        
        me.startCallbacks = me.startCallbacks || [];
        me.startCallbacks.push(cb);
        
        clearTimeout(me.startTimeout);
        me.startTimeout = setTimeout(function(){
            me.serverStarted = true;
            $.ajax({
                url: FileApi.ajax_url,
                data: {_type:"php_server_start",port:me.options.port},
                async: false,
                type: "POST",
                success: function (answer) {
                    console.debug(answer);
                    $.each(me.startCallbacks,function(i,cb){
                        cb();
                    });
                }
            });      
        },1);        
    }    
});
    
})(teacss.jQuery,teacss.ui);

