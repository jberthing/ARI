'use strict';

var ariModule = angular.module('ari');
ariModule.register.controller('MysensorsGWSettingsController', ['$scope', 'AriClient', "AriUser",
    function ($scope, AriClient, AriUser) {
        $scope.clientInfo = {};

        var ari = AriClient.create("MysensorsGW_Settings");

        ari.onconnect = function (result) {
            var clientName = result.name;

            // Get list of clients.
            ari.callFunction("MysensorsGW.getConfig", {}, function (err, result) {
                if (err) { console.log(err); return; }

                console.log(result);
                $scope.config = result;
                $scope.$apply();    // make sure nGular treats the update!
            });

            $scope.saveConfig = function ()
            {
                ari.callFunction("MysensorsGW.setConfig", $scope.config, function (err, result) {
                    if (err) { console.log(err); return; }
                });
            }

            $scope.activateNodeId = function (nodeId)
            {
              var node = $scope.config.notAdded[nodeId];
              $scope.config.nodes[nodeId] = node;
              $scope.config.notAdded[nodeId] = null;
              delete $scope.config.notAdded[nodeId];
              $scope.$apply();
            }

            $scope.deActivateNodeId = function (nodeId)
            {
              var node = $scope.config.nodes[nodeId];
              $scope.config.notAdded[nodeId] = node;
              $scope.config.nodes[nodeId] = null;
              delete $scope.config.nodes[nodeId];
              $scope.$apply();
            }


        };



        $scope.$on('$destroy', function () {
            //if ($scope.clientInfo.name) ari.unsubscribe($scope.clientInfo.name + ".*");
            if (ari) ari.close();
            ari = null;
        });
    }
]);
