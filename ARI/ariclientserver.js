﻿"use strict";

var jwt = require('jwt-simple');

var AriClientServer = module.exports.AriClientServer = function (options) {
    var self = this;
    this._pendingCallbacks = {};
    this._server = options.ariServer;
    this._ws = options.websocket;
    this.name = "";
    this._subscriptions = {};
    this._nextReqId = 0;
    this.clientModel = null;    // This will be set after authentication.
    
    //this._server.clients.push(this);   // Put into list of connected clients.

    this._ws.on("message", function (message) {
        // !!! USE "SELF" !!!
        
        // DEBUG!
        console.log('-->', message);

        try { var msg = JSON.parse(message); }        
        catch (e) {
            console.log("Error: Illegal JSON in message! - Ignoring...");
            websocket.close(1002, "Protocol error.");
            handleClientDisconnect();
            return;
        }
        
        if ("req" in msg) {
            // Request message.
            var cmd = msg.cmd;
            if (!cmd) { console.log("Error: Missing comand in telegram! - Ignoring..."); return; };
            
            var functionName = "_webcall_" + cmd;
            if (functionName in self) {
                // Requested function name exists in this object. Call it...
                self[functionName](msg.pars, function (err, result) {
                    // reply with results...
                    var res = {};
                    res.res = msg.req;
                    res.err = err;
                    res.result = result;
                    self._ws.send(JSON.stringify(res, self.jsonReplacer));
                });
            } else {
                console.log("Error: Trying to call unknown webcall: ", functionName);
            }
        } else if ("res" in msg) {
            // Response message.
            var responseId = msg.res;
            // Get stored callback from calling function.
            msg.callback = self._pendingCallbacks[msg.res];
            delete self._pendingCallbacks[msg.res];
            msg.callback(msg.err, msg.result);
        } else {
            // Notofication message.
            var cmd = msg.cmd;
            if (!cmd) { console.log("Error: Missing comand in telegram! - Ignoring..."); return; };
            
            var functionName = "_webnotify_" + cmd;
            if (functionName in self) {
                // Requested notification function name exists in this object. Call it...
                self[functionName](msg.pars);
            }
        }
    });

    this._ws.on("close", function () { 
        // !!! USE SELF
        self.handleClientDisconnect();
        console.log("Client disconnected: ", self._givenName);
    });
};

AriClientServer.prototype.jsonReplacer = function (key, value) {
    //console.log("-- ", key, ",", value);
    if (key == undefined) return value;
    if (key.indexOf('_') == 0) return undefined;    // Don's show hidden members.
    return value;
}

AriClientServer.prototype.handleClientDisconnect = function () {
    console.log("Client disconnected.");
    if (!this.clientModel) return;  // Probably left before calling connect!
    
    if ((Object.keys(this.clientModel.values).length === 0) || (Object.keys(this.clientModel.functions).length === 0)) {
        if (!this.clientModel.pendingAuthorization) {   // If authorization is  pending we still need to persist client data!
            // remove client (e.g. don't persist!)
            delete this._server.clientModels[this.name];
        }
    }
    else {
        // persist, and mark as offline!
        this.clientModel.online = false;
        delete this.clientModel.__clientServer;
    }
}

// Send msg to client
AriClientServer.prototype._wsSend = function (msg) {
    this._ws.send(msg);
}

// Call method on client...
AriClientServer.prototype._call = function (command, parameters, callback) {
    // TODO: Intercept for local rpc-functions (if we are "serverserver" as opposed to clientserver!)
    
    // Send msg.
    var msg = {};
    msg.req = this._nextReqId++;
    msg.cmd = command;
    msg.pars = parameters;
    this._pendingCallbacks[msg.req] = callback;
    this._wsSend(JSON.stringify(msg));
}

// Notify client of something. (no return value!)...
AriClientServer.prototype._notify = function (command, parameters) {
    var msg = {};
    msg.cmd = command;
    msg.pars = parameters;
    this._wsSend(JSON.stringify(msg));
}

/*****************************************************************************/
AriClientServer.prototype._webcall_CONNECT = function (pars, callback) {
    if (!pars.name) { console.log("Error: Missing name of client whentrying to register client! - Ignoring..."); return; }
    var clientName = pars.name;

    var authToken = pars.authToken;
    if (authToken) {
        // Try to decode token.
        try { var token = jwt.decode(authToken, this._server.JWTSecret); }
        catch (e) { };
        if (!token) {
            callback("Error: Invalid authToken!", null);
            return;
        } else {
            // Authentication OK
            console.log("authentication success:", token);
            var user = token.name;
            
            // Link this client to clientModel.
            if(clientName != user) var clientModelName = user + "/" + clientName;
            else var clientModelName = user;
            this.name = clientModelName;

            this.clientModel = this._server.clientModels[clientModelName];
            if (this.clientModel) {
                // clientModel found.
                this.clientModel.online = true;
                this.clientModel.__clientServer = this;
                callback(null, { "name": clientName });
                return;
            } else {
                // clientModel not found. Create it.
                this.clientModel = {
                    "name": this.name, 
                    "created": new Date().toISOString(),
                    "online": true,
                    "ip": this._ws._socket.remoteAddress,
                    "__clientServer": this,
                    "values": {},
                    "functions": {}
                };
                
                this._server.clientModels[clientModelName] = this.clientModel;
                
                callback(null, { "name": clientName });
                return;
            }
        }
    } else {
        callback("Error: Invalid authToken!", null);
    }
};

AriClientServer.prototype._webcall_REQAUTHTOKEN = function (pars, callback) {

    if (!pars.name) { callback("Error: Missing name parameter when requesting authToken.", null); return; }
    if (!pars.role && !pars.password) { callback("Error: Missing parameter when requesting authToken.", null); return; }
    
    var name = pars.name;    
    var role = pars.role;
    var password = pars.password;
    
    if (password) {
        // Request is for existing user in system. Find user...
        if (name in this._server.userModels) {
            // Check password.
            if (this._server.userModels[name].password == password) {
                // Reply with authToken and possibly new Name.
                payload = { "name": name, "role": this._server.userModels[name].role, "created": this._server.userModels[name].created };
                var token = jwt.encode(payload, this._server.JWTSecret);
                callback(null, { "name": name, "authToken": token });
            } else {
                callback("Error: Login or password incorrect!", null);
                return;
            }
        } else {
            callback("Error: Login or password incorrect!", null);
            return;
        }
    } else {
        // Register device or controller.
        var allowPairing = true; // TODO: Get this from server!
        if (!allowPairing) { callback("Error: Requesting authToken not allowed at this time.", null); return; }
        if (pars.role != "device" && pars.role != "controller") {
            callback("Error: Unknown role when requesting authToken.", null);
            return;
        }
        
        // Find available user name.
        var newName = name;
        var count = 1;
        while (true) {
            if (!this._server.userModels[newName]) break;
            newName = name + "(" + count + ")";
            count++;
        }
        
        // Create new user.
        this._server.userModels[newName] = {};
        this._server.userModels[newName].name = newName;
        this._server.userModels[newName].created = new Date().toISOString();
        this._server.userModels[newName].role= role;
        
        // Reply with authToken and possibly new Name.
        var payload = { "name": newName, "role": pars.role, "created": new Date().toISOString() };
        var token = jwt.encode(payload, this._server.JWTSecret);
        callback(null, {"name": newName, "authToken": token });
    }
};


//-----------------------------------------------------------------------------
AriClientServer.prototype._webnotify_SETCLIENTINFO = function (clientInfo) {
    console.log("_webcall_CLIENTINFO", clientInfo);
    
    // clientInfo has already been JSON.parsed!

    // TODO: Merge client info with present info... Remove values, functions, etc. not in Info from client.
    if (clientInfo.values) {
        for (var key in this.clientModel.values) {
            if (!clientInfo.values[key]) {
                // value removed from clientInfo - remove from clientModel.
                delete this.clientModel.values[key];
            }
        }
    }
    if (clientInfo.functions) {
        for (var key in this.clientModel.functions) {
            if (!clientInfo.functions[key]) {
                // value removed from clientInfo - remove from clientModel.
                delete this.clientModel.functions[key];
            }
        }
    }
    // Perform deep merge from remote clientInfo to local clientModel.
    deepMerge(clientInfo, this.clientModel);
}

var deepMerge = function (source, destination) {
    for (var property in source) {
        if (typeof source[property] === "object" && source[property] !== null) {
            destination[property] = destination[property] || {};
            deepMerge(source[property], destination[property]);
        } else {
            destination[property] = source[property];
        }
    }
    return destination;
};


//-----------------------------------------------------------------------------
// Client wants to call remote function.
AriClientServer.prototype._webcall_CALLFUNCTION = function (pars, callback) {
    var rpcName = pars.name;
    if (!rpcName) {
        console.log("Error: Missing name of RPC to call! - Ignoring...");
        callback("Error: Missing name of RPC to call! - Ignoring...", null);
        return;
    }
    
    // Find RPC in other connected clients, in offline clients, in server registered rpc's or even in own client! (Ping yourself ;O)
    var rpcNameParts = rpcName.split(".");
    // Find client
    var client = this._server.clientModels[rpcNameParts[0]];
    if (client) {
        // Client found, now find rpc.
        var rpc = client.functions[rpcNameParts[1]];
        if (rpc) {
            if ((client.online == false) || !client.__clientServer) {
                callback("Error: Target client for function call is offline.", null);
                return;
            } else {
                client.__clientServer._call("CALLFUNCTION", { "name": rpcName.substring(rpcName.indexOf(".") + 1), "params": pars.params}, function (err, result) { 
                    callback(err, result);
                });
            }
        }
        else {
            callback("Error: Target function call not registered.", null);
            return;
        }
    }
    else {
        callback("Error: Target client for function call not registered.", null);
        return;
    }
};

//-----------------------------------------------------------------------------
// Client wants to subscribe to topic.
// TODO: Needs update after implementing values.!
AriClientServer.prototype._webcall_SUBSCRIBE = function (pars, callback) {
    console.log("subscribe(", pars, ")");
    
    var name = pars.name;
    if (!name) { callback("Error: No name parameter specified!", null); return; }
    
    this._subscriptions[name] = {}; // Just indicate that there is a subscription to topic/value.
    
    callback(null, {}); // Send reply before sending latest values!!!
    
    // Send last values of subscribed values.
    for (var key in this._server.clientModels) {
        var client = this._server.clientModels[key];
        if (client.values) {
            for (var valName in client.values) {
                if (this.matches(name, client.name + "." + valName)) {
                    var clientValueModel = client.values[valName];
                    if (clientValueModel.last) {
                        this._notify("PUBLISH", { "name": client.name + "." + valName , "value": clientValueModel.last });
                    }
                }
            }
        }
    }
}

// Helper function to match strA (possibly including wildcard *) to strB.
AriClientServer.prototype.matches = function (strA, strB) {
    if (strA == strB) return true;
    var aPos = strA.indexOf('*');
    if (aPos >= 0) {
        var aStr = strA.substring(0, aPos);
        if (aStr == strB.substring(0, aPos)) return true;
    }
    return false;
}

// Client wants to unsibscribe from subscription.
AriClientServer.prototype._webcall_UNSUBSCRIBE = function (pars, callback) {
    console.log("unsubscribe(", pars, ")");
    
    var name = pars.name;
    if (!name) { callback("Error: No name parameter specified!", null); return; }
    
    delete this._subscriptions[name];
    callback(null, {});
}

// Client want to publish a topic with a value.
AriClientServer.prototype._webnotify_PUBLISH = function (pars) {
    //console.log("publish(", pars, ")");
    
    var valueName = pars.name;
    if (!valueName) {
        console.log("Error: Missing name of value to publish! - Ignoring...");
        return;
    }
    this._server.publish(this.name + "." + valueName, pars.value);
}

/*****************************************************************************/
// Client wants to watch for change to a remote value.
AriClientServer.prototype._webnotify_WATCHVALUE = function (pars, callback) {
    var name = pars.name;
    if (!name) { callback("Error: No name parameter specified!", null); return; }
    
    if (!this.clientModel._watches) this.clientModel._watches = {};
    this.clientModel._watches[name] = {}; // Just indicate that this client watches this value.

    // Send last values of subscribed values.
    for (var key in this._server.clientModels) {
        var client = this._server.clientModels[key];
        if (client.values) {
            for (var valName in client.values) {
                if (this.matches(name, client.name + "." + valName)) {
                    var clientValue = client.values[valName];
                    if (clientValue && clientValue.value) {
                        this._notify("VALUE", { "name": client.name + "." + valName , "value": clientValue.value });
                    }
                }
            }
        }
    }
}

// Client notifies that a member value (of this client) was set.
AriClientServer.prototype._webnotify_VALUE = function (pars) {
    var valueName = pars.name;
    if (!valueName) {
        console.log("Error: Missing name of value to publish! - Ignoring...");
        return;
    }
    // Add client name to path and let server handle.
    this._server.handleValue(this.name + "." + valueName, pars.value);
}

// Client wants to set remote (no-local) value.
AriClientServer.prototype._webnotify_SETVALUE = function (pars) {
    var name = pars.name;
    var value = pars.value;
    if (!name || !value) {
        console.log("Error: Missing name or value to set! - Ignoring...");
        return;
    }

    // Add client name to path and let server handle.
    this._server.setValue(name, value);
}
