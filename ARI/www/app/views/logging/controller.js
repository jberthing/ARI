'use strict';

var ariModule = angular.module('ari');
ariModule.register.controller('loggingController', ["$scope", "$interval", 'AriClient',
    function ($scope, $interval, AriClient) {
        
        var ari = AriClient.create("ari_clients");
        ari.onconnect = function (result) {
            var clientName = result.name;
            console.log("Client connected as \"" + ari.name + "\"");
            
            // Get list of clients.
            ari.callFunction("ari.listLogs", {}, function (err, result) {
                if (err) { console.log(err); return; }
                
                console.log("listLogs -->", result);
                $scope.logs = result;
                $scope.$apply();    // make sure nGular treats the update!
            });
            
            $scope.logSelected = function (logName) {
                ari.callFunction("ari.getLog", { "name": logName }, function (err, result) {
                    if (err) { console.log(err); return; }
                    var entries = result.split("\n");
                    var data = [];
                    entries.forEach(function (entry) {
                        var split = entry.indexOf(",");
                        if (split == -1) return;    // This is like "continue"!!!
                        var time = +entry.substring(0, split);
                        var value = JSON.parse(entry.substring(split + 1));
                        //data.push({ "time": new Date(time), "value": value });
                        data.push({ "time": time, "value": value });
                    });

                    $scope.logName = logName;
                    $scope.data = data;
                    $scope.$apply();    // make sure nGular treats the update!
                
/*                if (!$scope.clientInfo.values) $scope.clientInfo.values = {};
                //var lscope = $scope;
                ari.subscribe(clientName + ".*", function (path, value) {
                    console.log("->", path, "=", value);
                    // Remove client name from valuename since we will show it as a "child" of the client.
                    path = path.substring(path.indexOf(".") + 1);
                    if (!$scope.clientInfo.values[path]) $scope.clientInfo.values[path] = {};
                    $scope.clientInfo.values[path].value = value;
                    $scope.$apply();
                });*/
                });
            }
        };
        
        $scope.$on('$destroy', function () {
            //if ($scope.clientInfo.name) ari.unsubscribe($scope.clientInfo.name + ".*");
            if (ari) ari.close();
            ari = null;
        });
    }
]);


var newLogFormat = 
 {
    name: "GW433.garage.humidity", 
    parameters: [
        { name: "time" }, 
        { name: "value", unit: "%" }
    ],
    data: [
        [1445438391424, 80],
        [1445438391424, 80],
        [1445438391424, 80]
    ]
}
