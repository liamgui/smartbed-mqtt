import { Connection } from '@2colors/esphome-native-api';
import { Dictionary } from '@utils/Dictionary';
import { Deferred } from '@utils/deferred';
import { logInfo, logWarn } from '@utils/logger';
import { seconds } from '@utils/seconds';
import { IESPConnection } from './IESPConnection';
import { connect } from './connect';
import { mergeAdvertisement, newAdvertisement } from './mergeAdvertisement';
import { BLEAdvertisement } from './types/BLEAdvertisement';
import { BLEDevice } from './types/BLEDevice';
import { IBLEDevice } from './types/IBLEDevice';

// How long to keep listening for advertisements after every configured device has been found, when
// one of them is still missing the data device detection relies on.
const ADVERTISEMENT_SETTLE_TIME = seconds(5);

const hasAdvertisementData = ({ advertisement: { serviceUuidsList, manufacturerDataList } }: IBLEDevice) =>
  !!serviceUuidsList.length || !!manufacturerDataList.length;

export class ESPConnection implements IESPConnection {
  constructor(private connections: Connection[]) {}

  async reconnect(): Promise<void> {
    this.disconnect();
    logInfo('[ESPHome] Reconnecting...');
    this.connections = await Promise.all(
      this.connections.map((connection) =>
        connect(new Connection({ host: connection.host, port: connection.port, password: connection.password }))
      )
    );
  }

  disconnect(): void {
    logInfo('[ESPHome] Disconnecting...');

    for (const connection of this.connections) {
      connection.disconnect();
      connection.connected = false;
    }
  }

  async getBLEDevices(deviceNames: string[], nameMapper?: (name: string) => string): Promise<IBLEDevice[]> {
    logInfo(`[ESPHome] Searching for device(s): ${deviceNames.join(', ')}`);
    deviceNames = deviceNames.map((name) => name.toLowerCase());
    const bleDevices: IBLEDevice[] = [];
    const complete = new Deferred<void>();
    let settleTimeout: NodeJS.Timeout | undefined;
    await this.discoverBLEDevices(
      (bleDevice) => {
        const { name, mac } = bleDevice;
        let index = deviceNames.indexOf(mac);
        if (index === -1) index = deviceNames.indexOf(name.toLowerCase());
        if (index === -1) return;

        deviceNames.splice(index, 1);
        logInfo(`[ESPHome] Found device: ${name} (${mac})`);
        bleDevices.push(bleDevice);
        if (deviceNames.length) return;

        // A device is found as soon as a packet carrying its name arrives, which can be before the
        // packet carrying its service uuids or manufacturer data. Keep listening a little longer so
        // the rest of the advertisement can be merged in before device detection runs.
        if (bleDevices.every(hasAdvertisementData)) {
          complete.resolve();
          return;
        }
        if (settleTimeout) return;
        logInfo('[ESPHome] Waiting for complete advertisement data...');
        settleTimeout = setTimeout(() => complete.resolve(), ADVERTISEMENT_SETTLE_TIME);
      },
      complete,
      nameMapper
    );
    if (settleTimeout) clearTimeout(settleTimeout);
    if (deviceNames.length) logWarn(`[ESPHome] Cound not find address for device(s): ${deviceNames.join(', ')}`);
    return bleDevices;
  }

  async discoverBLEDevices(
    onNewDeviceFound: (bleDevice: IBLEDevice) => void,
    complete: Promise<void>,
    nameMapper?: (name: string) => string
  ) {
    const seenAddresses: number[] = [];
    // ESPHome forwards each advertising packet separately, so accumulate them per address rather
    // than acting on whichever packet arrived first. BLEDevice keeps a reference to the merged
    // advertisement and reads through to it, so packets that arrive after a device has been found
    // still reach device detection.
    const advertisements: Dictionary<BLEAdvertisement> = {};
    const listenerBuilder = (connection: Connection) => ({
      connection,
      listener: (advertisement: BLEAdvertisement) => {
        const { address } = advertisement;

        let merged = advertisements[address];
        if (!merged) {
          merged = newAdvertisement(advertisement);
          advertisements[address] = merged;
        } else {
          mergeAdvertisement(merged, advertisement);
        }

        if (seenAddresses.includes(address) || !merged.name) return;
        seenAddresses.push(address);

        const name = nameMapper ? nameMapper(merged.name) : merged.name;
        onNewDeviceFound(new BLEDevice(name, merged, connection));
      },
    });
    const listeners = this.connections.map(listenerBuilder);
    for (const { connection, listener } of listeners) {
      connection.on('message.BluetoothLEAdvertisementResponse', listener).subscribeBluetoothAdvertisementService();
    }
    await complete;
    for (const { connection, listener } of listeners) {
      connection.off('message.BluetoothLEAdvertisementResponse', listener);
    }
  }
}
