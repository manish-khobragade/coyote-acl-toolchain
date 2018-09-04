/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */


String.prototype.toDateFromDatetime = function () {
    var parts = this.split(/[- :]/);
    return new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
};

function diffMinutes(dt2, dt1) {
    var diff = (dt2.getTime() - dt1.getTime()) / 1000;
    diff /= 60;
    return Math.abs(Math.round(diff));
}

/**
 * A shipment has been received by the customer
 * @param {org.coyote.playground.blockchain.demo.ShipmentReceived} shipmentReceived - the ShipmentReceived transaction
 * @transaction
 */
function shipmentDelivered(shipmentReceived) {
    var contract = shipmentReceived.shipment.contract;
    var shipment = shipmentReceived.shipment;
    var payOut = contract.unitPrice * shipment.unitCount;
    var shipmentAmount = payOut;
    var penalty = 0;
    var NS = 'org.coyote.playground.blockchain.demo';
    var deliveryTimeActual = shipmentReceived.actualDeliveredTime;
    // set the status of the shipment
    shipment.status = 'DELIVERED';
    var message = 'Shipment has arrived at the destination';


    // calculate penalty for temperature violation
    if (shipment.temperatureReadings) {
        var minimumTempViolationCount = shipment.temperatureReadings.filter(function (reading) { return reading.centigrade < contract.minTemperature; }).length;
        var maxTempViolationCount = shipment.temperatureReadings.filter(function (reading) { return reading.centigrade > contract.maxTemperature; }).length;
        console.log('Min Temp Count : ' + minimumTempViolationCount);
        console.log('Max Temp Count : ' + maxTempViolationCount);
        if (minimumTempViolationCount > 0) {
            penalty += (minimumTempViolationCount * contract.minTempViolationPenalty);
            console.log('Min Penalty : ' + minimumTempViolationCount * contract.minTempViolationPenalty);
        }

        if (maxTempViolationCount > 0) {
            penalty += (maxTempViolationCount * contract.maxTempViolationPenalty);
            console.log('Max Penalty : ' + maxTempViolationCount * contract.maxTempViolationPenalty);
        }
    }

    // calculate penalty for late arrivals
    if (shipment.loadStops) {
        var loadStopPickup = shipment.loadStops.filter(function (ls) { return ls.stopType === "PICKUP" })[0];
        var appointmentTimePickup = loadStopPickup.appointmentTime.toDateFromDatetime();
        var actualTimePickup = loadStopPickup.actualTime.toDateFromDatetime();
        if (appointmentTimePickup < actualTimePickup) {
            penalty += contract.pickupLateFee;
        }

        var loadStopDelivery = shipment.loadStops.filter(function (ls) { return ls.stopType === "DELIVERY" })[0];
        var index = shipment.loadStops.indexOf(loadStopDelivery);
        var appointmentTimeDelivery = loadStopDelivery.appointmentTime.toDateFromDatetime();
        var actualTimeDelivery = deliveryTimeActual.toDateFromDatetime();
        shipment.loadStops[index].actualTime = deliveryTimeActual;
        if (appointmentTimeDelivery < actualTimeDelivery) {
            penalty += contract.deliveryLateFee;
            var timeDiffInMinutes = diffMinutes(actualTimeDelivery, appointmentTimeDelivery);
            message = 'Carrier checked in ' + timeDiffInMinutes + ' minutes past scheduled appointment time of ' + appointmentTimeDelivery;
        }
    }
    console.log('Total Penalty : ' + penalty);
    payOut -= penalty;
    contract.customer.accountBalance -= payOut;
    contract.broker.accountBalance += ((payOut * contract.brokerMargin) / 100);
    contract.carrier.accountBalance += (payOut - ((payOut * contract.brokerMargin) / 100));

    var factory = getFactory();
    var shipmentArrived = factory.newEvent(NS, 'ShipmentHasArrived');
    shipmentArrived.shipment = shipment;
    shipmentArrived.shipmentAmount = shipmentAmount;
    shipmentArrived.penalty = penalty;
    shipmentArrived.message = message;

    //Shipment
    shipment.totalAmount = shipmentAmount;
    shipment.totalPenalty = penalty;

    emit(shipmentArrived);

    return getParticipantRegistry('org.coyote.playground.blockchain.demo.Customer')
        .then(function (customerRegistry) {
            // update the customer's balance

            return customerRegistry.update(contract.customer);
        })
        .then(function () {
            return getParticipantRegistry('org.coyote.playground.blockchain.demo.Broker');
        })
        .then(function (brokerRegistry) {
            // update the broker's balance
            return brokerRegistry.update(contract.broker);
        })
        .then(function () {
            return getParticipantRegistry('org.coyote.playground.blockchain.demo.Carrier');
        })
        .then(function (carrierRegistry) {
            // update the carrier's balance
            return carrierRegistry.update(contract.carrier);
        })
        .then(function () {
            return getAssetRegistry('org.coyote.playground.blockchain.demo.Shipment');
        })
        .then(function (shipmentRegistry) {
            // update the state of the shipment
            return shipmentRegistry.update(shipment);
        });

}



/**
 * A temperature reading has been received for a shipment
 * @param {org.coyote.playground.blockchain.demo.TemperatureReading} temperatureReading - the TemperatureReading transaction
 * @transaction
 */
function temperatureReading(temperatureReading) {

    var shipment = temperatureReading.shipment;
    var NS = 'org.coyote.playground.blockchain.demo';
    var contract = shipment.contract;
    var factory = getFactory();

    if (shipment.temperatureReadings) {
        shipment.temperatureReadings.push(temperatureReading);
    } else {
        shipment.temperatureReadings = [temperatureReading];
    }

    if (temperatureReading.centigrade < contract.minTemperature ||
        temperatureReading.centigrade > contract.maxTemperature) {
        var violationType = '';
        var message = '';
        if (temperatureReading.centigrade < contract.minTemperature) {
            violationType = 'Temperature Below Threshold';
            message = 'Shipment temperature fell below designated threshold of ' + contract.minTemperature;
        } else {
            violationType = 'Temperature Above Threshold';
            message = 'Shipment temperature rose above designated threshold of ' + contract.maxTemperature;
        }

        var temperatureEvent = factory.newEvent(NS, 'TemperatureThresholdEvent');
        temperatureEvent.shipment = shipment;
        temperatureEvent.temperature = temperatureReading.centigrade;
        temperatureEvent.temperatureViolationType = violationType;
        temperatureEvent.message = message;
        emit(temperatureEvent);
    }

    return getAssetRegistry(NS + '.Shipment')
        .then(function (shipmentRegistry) {
            return shipmentRegistry.update(shipment);
        });
}

/**
 * A GPS reading has been received for a shipment
 * @param {org.coyote.playground.blockchain.demo.GpsReading} gpsReading - the GpsReading transaction
 * @transaction
 */
function gpsReading(gpsReading) {
    var factory = getFactory();
    var NS = "org.coyote.playground.blockchain.demo";
    var shipment = gpsReading.shipment;

    if (shipment.gpsReadings) {
        shipment.gpsReadings.push(gpsReading);
    } else {
        shipment.gpsReadings = [gpsReading];
    }

    var latLong = 'LAT:' + gpsReading.latitude + gpsReading.latitudeDir + ' LONG:' +
        gpsReading.longitude + gpsReading.longitudeDir;


    var shipmentInPortEvent = factory.newEvent(NS, 'ShipmentInPortEvent');
    shipmentInPortEvent.shipment = shipment;
    var message = 'Shipment has reached at ' + latLong;
    shipmentInPortEvent.message = message;
    emit(shipmentInPortEvent);

    return getAssetRegistry(NS + '.Shipment')
        .then(function (shipmentRegistry) {
            // add the gps reading to the shipment
            return shipmentRegistry.update(shipment);
        });
}


/**
 * A shipment has been created and now it will be accepted by carrier
 * @param {org.coyote.playground.blockchain.demo.ShipmentAccepted} shipmentAccepted - the ShipmentAccepted transaction
 * @transaction
 */
function shipmentAccepted(shipmentAccepted) {
    var shipment = shipmentAccepted.shipment;
    var NS = 'org.coyote.playground.blockchain.demo';
    shipment.status = 'ACCEPTED';
    console.log('Shipment current ' + shipment);
    var shipmentRegistry = getAssetRegistry(NS + '.Shipment')
        .then(function (shipmentRegistry) {
            // add the accepted state to the shipment
            return shipmentRegistry.update(shipment);
        });
}


/**
 * A shipment has been picked up by Carrrier
 * @param {org.coyote.playground.blockchain.demo.ShipmentPickedUp} shipmentPicked - the Shipment Picked Up transaction
 * @transaction
 */
function shipmentPickedUp(shipmentPicked) {
    var factory = getFactory();
    var shipment = shipmentPicked.shipment;
    var pickUpTime = shipmentPicked.actualPickupTime
    var NS = 'org.coyote.playground.blockchain.demo';
    shipment.status = 'PICKEDUP';
    if (shipment.loadStops) {
        var loadStopPickup = shipment.loadStops.filter(function (ls) { return ls.stopType === 'PICKUP' })[0];
        if (loadStopPickup != null) {

            var index = shipment.loadStops.indexOf(loadStopPickup);
            shipment.loadStops[index].actualTime = pickUpTime;

            var appointmentTimePickup = shipment.loadStops[index].appointmentTime.toDateFromDatetime();
            var actualTimePickup = shipment.loadStops[index].actualTime.toDateFromDatetime();

            if (appointmentTimePickup < actualTimePickup) {
                var shipmentLatePickedUp = factory.newEvent(NS, 'ShipmentLatePickup');
                shipmentLatePickedUp.shipment = shipment;
                var timeDiffInMinutes = diffMinutes(actualTimePickup, appointmentTimePickup);
                var message = 'Carrier checked in ' + timeDiffInMinutes + ' minutes past scheduled appointment time of ' + appointmentTimePickup;
                shipmentLatePickedUp.message = message;
                emit(shipmentLatePickedUp);
            }

            var shipmentRegistry = getAssetRegistry(NS + '.Shipment')
                .then(function (shipmentRegistry) {
                    // add the accepted state to the shipment
                    return shipmentRegistry.update(shipment);
                });
        }
        else {
            return 'Pick Up not defined';
        }
    }
    else {
        return 'Load Stops not defined';
    }
}