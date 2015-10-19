﻿"use strict";

// ARI (Automation Routing Infrastructure)
//var SortedObjectArray = require("./sorted-object-array");
var AriClientServer = require("./ariclientserver.js").AriClientServer;
var AriServerServer = require("./ariserverserver.js").AriServerServer;
var ConfigStore = require("./configStore.js");

var Ari = module.exports.Ari = function (options) {
    var self = this;
    this._wss = options.websocketServer;
    this.pendingClients = {};       // new SortedObjectArray('name');   // List of clients awaiting approval
    
    // Load config.    
    var configStore = new ConfigStore(__dirname, "ari_config");
    var config = configStore.load();
    
    // Load state.
    this.stateStore = new ConfigStore(__dirname, "ari_state");
    var state = this.stateStore.load();
    
    this.JWTSecret = config.JWTSecret || 'AriSecret';
    
    this.clientsModel = state.clients || {};
    this.usersModel = state.users || {};
    this.loggingConfig = state.loggingConfig || { "values": {} };
    this.logs = {};
    
    // DEBUG!!!!
    this.loggingConfig = {
        "values": { "GW433.*": {} },
        "saveInterval": "10"
    };
    
    // Save log every at intervals
    setInterval(this.saveLog, this.loggingConfig.saveInterval * 60 * 1000);

    // Persisted client information indexed by client.givenName. Contains infor about connection state, etc...
    // ari: represents the server API, etc.
    var serverServer = new AriServerServer({ "ariServer": this, "name": "ari" });   
        
    this._wss.on('connection', function connection(ws) {
        // Use "SELF!
        // Create AriClientServer to handle serving of this client.
        var clientServer = new AriClientServer({ ariServer: self, websocket: ws });
    });

    // DEBUG
    /*Object.observe(this.clientsModel, function (changes) {
        changes.forEach(function (change) {
            console.log("--Observed _clientsModel:", change.type, change.name);
            if (change.type == "add") {
                Object.observe(change.object[change.name].functions, function (changes) {
                    changes.forEach(function (change) {
                        console.log("--Observed ?:", change.type, change.name);
                    });
                });
            }
        });
    });*/
};

// Main function called by clients.!
Ari.prototype.callRpc = function (name, params, callback) {
    // Find client...
    var clientName = name.split(".");
    for (client in this._clients) {
        if (client.name == clientName) {
            ariClient.callRpc(name, params, callback);
        }
    }
}

// Main publish function called by all clients.!
Ari.prototype.publish = function (name, value) {
    
    // This would be a good place to log values...
    console.log("PUB:", name, "=", value);
    
    for (var key in this.loggingConfig.values) {
        var loggingConfig = this.loggingConfig.values[key];
        if (this.matches(key, name)) {
            if (!this.logs[name]) this.logs[name] = []; // Create if not exists.
            var ds = (new Date()).toISOString().replace(/[^0-9]/g, "");
            this.logs[name].push({ "t": ds, "v": value });
        }
    }

    var loggingConfig = this.loggingConfig.values[name];
    if (loggingConfig) {
        // For now, if it's present in loggingConfig, we log values...
        if (!this.logs[name]) this.logs[name] = []; // Create if not exists.
        this.logs[name].push({ "time": new Date().toISOString(), "value": value });
    }
    

    var clientName = name.split(".")[0];
    
    // Store last value and time of update.
    var client = this.clientsModel[clientName];
    if (client) {
        if (client.values) {
            var clientValueName = name.substring(name.indexOf(".") + 1);
            var clientValue = client.values[clientValueName];
            if (clientValue) {
                clientValue.last = value;
                clientValue.updated = new Date().toISOString();
            }
        }
    }
    
    // Find all subscribing and connected clients and notify...
    for (var key in this.clientsModel) {
        var client = this.clientsModel[key];
        if (client) {
            if (client.online == true) {
                var cs = client.__clientServer;
                if (cs) {
                    for (var subName in cs._subscriptions) {
                        if (this.matches(subName, name)) {
                            cs._notify("PUBLISH", { "name": name , "value": value });
                        }
                    }
                }
            }
        }
    }
}

Ari.prototype.matches = function(strA, strB)
{
    if (strA == strB) return true;
    var aPos = strA.indexOf('*');
    if (aPos >= 0) {
        var aStr = strA.substring(0, aPos);
        if (aStr == strB.substring(0, aPos)) return true;
    }
    return false;
}


Ari.prototype.shutDown = function () {
    // Store state...
    var state = {
        "clients": this.clientsModel , 
        "users": this.usersModel,
        "loggingConfig": this.loggingConfig
    };
    this.stateStore.save(state);

    this.saveLog();
}

Ari.prototype.saveLog = function(){
    var d = new Date();
    var fileName = "ari_logs_" + (new Date()).toISOString().replace(/[^0-9]/g, "");
    var logStore = new ConfigStore(__dirname, fileName);
    logStore.save({ "logs": this.logs }, false);
}
