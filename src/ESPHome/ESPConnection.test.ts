import { Connection } from '@2colors/esphome-native-api';
import { EventEmitter } from 'events';
import { ESPConnection } from './ESPConnection';
import { BLEAdvertisement } from './types/BLEAdvertisement';

const NORDIC_UART = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const ADDRESS = 95985339475591;
const NAME = 'QRRM150966';

// ESPHome forwards each raw advertising packet separately, so a device's name and its service
// uuids routinely arrive in different packets. These tests cover that split, which is what made
// beds report as unsupported.
class FakeConnection extends EventEmitter {
  subscribeBluetoothAdvertisementService = jest.fn();

  advertise = (advertisement: Partial<BLEAdvertisement>) =>
    this.emit('message.BluetoothLEAdvertisementResponse', {
      name: '',
      address: ADDRESS,
      rssi: -60,
      addressType: 0,
      manufacturerDataList: [],
      serviceDataList: [],
      serviceUuidsList: [],
      ...advertisement,
    });
}

const buildConnection = () => {
  const connection = new FakeConnection();
  return { connection, esphome: new ESPConnection([connection as unknown as Connection]) };
};

describe('ESPConnection', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('merges service uuids that arrive after the device was found', async () => {
    const { connection, esphome } = buildConnection();

    const devices = esphome.getBLEDevices([NAME.toLowerCase()]);
    connection.advertise({ name: NAME });
    connection.advertise({ serviceUuidsList: [NORDIC_UART] });
    jest.runAllTimers();

    const [device] = await devices;
    expect(device.name).toEqual(NAME);
    expect(device.advertisement.serviceUuidsList).toEqual([NORDIC_UART]);
  });

  it('merges service uuids that arrived before the device was named', async () => {
    const { connection, esphome } = buildConnection();

    const devices = esphome.getBLEDevices([NAME.toLowerCase()]);
    connection.advertise({ serviceUuidsList: [NORDIC_UART] });
    connection.advertise({ name: NAME });

    const [device] = await devices;
    expect(device.name).toEqual(NAME);
    expect(device.advertisement.serviceUuidsList).toEqual([NORDIC_UART]);
  });

  it('does not wait when the first packet already has the data', async () => {
    const { connection, esphome } = buildConnection();

    const devices = esphome.getBLEDevices([NAME.toLowerCase()]);
    connection.advertise({ name: NAME, serviceUuidsList: [NORDIC_UART] });

    expect(jest.getTimerCount()).toEqual(0);
    const [device] = await devices;
    expect(device.advertisement.serviceUuidsList).toEqual([NORDIC_UART]);
    expect(connection.subscribeBluetoothAdvertisementService).toHaveBeenCalled();
  });

  it('still returns a device that never advertises any data', async () => {
    const { connection, esphome } = buildConnection();

    const devices = esphome.getBLEDevices([NAME.toLowerCase()]);
    connection.advertise({ name: NAME });
    jest.runAllTimers();

    const [device] = await devices;
    expect(device.name).toEqual(NAME);
    expect(device.advertisement.serviceUuidsList).toEqual([]);
  });

  it('ignores advertisements for devices that are not configured', async () => {
    const { connection, esphome } = buildConnection();

    const devices = esphome.getBLEDevices([NAME.toLowerCase()]);
    connection.advertise({ name: 'SomeOtherDevice', address: 1 });
    connection.advertise({ name: NAME, serviceUuidsList: [NORDIC_UART] });

    const found = await devices;
    expect(found).toHaveLength(1);
    expect(found[0].name).toEqual(NAME);
  });

  it('stops listening once every configured device is found', async () => {
    const { connection, esphome } = buildConnection();

    const devices = esphome.getBLEDevices([NAME.toLowerCase()]);
    connection.advertise({ name: NAME, serviceUuidsList: [NORDIC_UART] });
    await devices;

    expect(connection.listenerCount('message.BluetoothLEAdvertisementResponse')).toEqual(0);
  });
});
