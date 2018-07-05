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

/**
 * A shipment has been received by the customer
 * @param {org.acme.shipping.perishable.ShipmentReceived} shipmentReceived - the ShipmentReceived transaction
 * @transaction
 */
function payOut(shipmentReceived) {
    var contract = shipmentReceived.shipment.contract;
    var shipment = shipmentReceived.shipment;
    var payOut = contract.unitPrice * shipment.unitCount;
    var shipmentAmount = payOut;
    var penalty = 0;
    var NS = 'org.acme.shipping.perishable';
    //console.log('Received at: ' + shipmentReceived.timestamp);
    //console.log('Contract arrivalDateTime: ' + contract.arrivalDateTime);

    // set the status of the shipment
    shipment.status = 'ARRIVED';


    // find the lowest temperature reading
    if (shipment.temperatureReadings) {
        // sort the temperatureReadings by centigrade
        shipment.temperatureReadings.sort(function (a, b) {
            return (a.centigrade - b.centigrade);
        });
        var lowestReading = shipment.temperatureReadings[0];
        var highestReading = shipment.temperatureReadings[shipment.temperatureReadings.length - 1];

        //console.log('Lowest temp reading: ' + lowestReading.centigrade);
        //console.log('Highest temp reading: ' + highestReading.centigrade);

        // does the lowest temperature violate the contract?
        if (lowestReading.centigrade < contract.minTemperature) {
            penalty += (contract.minTemperature - lowestReading.centigrade) * contract.minPenaltyFactor;
            //console.log('Min temp penalty: ' + penalty);
        }

        // does the highest temperature violate the contract?
        if (highestReading.centigrade > contract.maxTemperature) {
            penalty += (highestReading.centigrade - contract.maxTemperature) * contract.maxPenaltyFactor;
            //console.log('Max temp penalty: ' + penalty);
        }

        // apply any penalities
        payOut -= (penalty * shipment.unitCount);

        if (payOut < 0) {
            payOut = 0;
        }
    }

    //console.log('Payout: ' + payOut);
    if (payOut > 0) {
        contract.customer.accountBalance -= payOut;
        contract.broker.accountBalance += ((payOut * contract.brokerMargin) / 100);
        contract.carrier.accountBalance += (payOut - ((payOut * contract.brokerMargin) / 100));
    }
    var factory = getFactory();
    var shipmentArrived = factory.newEvent(NS, 'ShipmentHasArrived');
    shipmentArrived.shipment = shipment;
    shipmentArrived.shipmentAmount = shipmentAmount;
    shipmentArrived.penalty = penalty;
    var message = 'Shipment has arrived at the destination';
    shipmentArrived.message = message;
    emit(shipmentArrived);

    return getParticipantRegistry('org.acme.shipping.perishable.Customer')
        .then(function (customerRegistry) {
            // update the customer's balance

            return customerRegistry.update(contract.customer);
        })
        .then(function () {
            return getParticipantRegistry('org.acme.shipping.perishable.Broker');
        })
        .then(function (brokerRegistry) {
            // update the broker's balance
            return brokerRegistry.update(contract.broker);
        })
        .then(function () {
            return getParticipantRegistry('org.acme.shipping.perishable.Carrier');
        })
        .then(function (carrierRegistry) {
            // update the carrier's balance
            return carrierRegistry.update(contract.carrier);
        })
        .then(function () {
            return getAssetRegistry('org.acme.shipping.perishable.Shipment');
        })
        .then(function (shipmentRegistry) {
            // update the state of the shipment
            return shipmentRegistry.update(shipment);
        });
 
}

/**
 * A temperature reading has been received for a shipment
 * @param {org.acme.shipping.perishable.TemperatureReading} temperatureReading - the TemperatureReading transaction
 * @transaction
 */
function temperatureReading(temperatureReading) {

    var shipment = temperatureReading.shipment;
    var NS = 'org.acme.shipping.perishable';
    var contract = shipment.contract;
    var factory = getFactory();

    //console.log('Adding temperature ' + temperatureReading.centigrade + ' to shipment ' + shipment.$identifier);

    if (shipment.temperatureReadings) {
        shipment.temperatureReadings.push(temperatureReading);
    } else {
        shipment.temperatureReadings = [temperatureReading];
    }

    if (temperatureReading.centigrade < contract.minTemperature ||
        temperatureReading.centigrade > contract.maxTemperature) {
        var temperatureEvent = factory.newEvent(NS, 'TemperatureThresholdEvent');
        temperatureEvent.shipment = shipment;
        temperatureEvent.temperature = temperatureReading.centigrade;
        temperatureEvent.message = 'Temperature threshold violated! Emitting TemperatureEvent for shipment: ' + shipment.$identifier;
        //console.log(temperatureEvent.message);
        emit(temperatureEvent);
    }

    return getAssetRegistry(NS + '.Shipment')
        .then(function (shipmentRegistry) {
            // add the temp reading to the shipment
            return shipmentRegistry.update(shipment);
        });
}

/**
 * A GPS reading has been received for a shipment
 * @param {org.acme.shipping.perishable.GpsReading} gpsReading - the GpsReading transaction
 * @transaction
 */
function gpsReading(gpsReading) {

    var factory = getFactory();
    var NS = "org.acme.shipping.perishable";
    var shipment = gpsReading.shipment;


    if (shipment.gpsReadings) {
        shipment.gpsReadings.push(gpsReading);
    } else {
        shipment.gpsReadings = [gpsReading];
    }

    var latLong = '/LAT:' + gpsReading.latitude + gpsReading.latitudeDir + '/LONG:' +
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
 * @param {org.acme.shipping.perishable.ShipmentAccepted} shipmentAccepted - the ShipmentAccepted transaction
 * @transaction
 */
function shipmentAccepted(shipmentAccepted) {
    var shipment = shipmentAccepted.shipment;
    var NS = 'org.acme.shipping.perishable';
    if (shipment.status == "CREATED") {
        shipment.status = "ACCEPTED";
        var shipmentRegistry = getAssetRegistry(NS + '.Shipment')
            .then(function (shipmentRegistry) {
                // add the accepted state to the shipment
                return shipmentRegistry.update(shipment);
            });

    } else {
        var factory = getFactory();
        var shipmentAcceptedError = factory.newEvent(NS, 'ShipmentAcceptedError');
        shipmentAcceptedError.shipment = shipment;
        var message = 'Shipment has already passed accepted state';
        shipmentAcceptedError.message = message;
        emit(shipmentAcceptedError);
        return "Shipment cannot be set to accepted";
    }
}