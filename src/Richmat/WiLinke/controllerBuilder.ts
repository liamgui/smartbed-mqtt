import { IDeviceData } from '@ha/IDeviceData';
import { BLEController } from 'BLE/BLEController';
import { IBLEDevice } from 'ESPHome/types/IBLEDevice';
import { supportedBeds } from './supportedBeds';

const buildCommand = (command: number) => [110, 1, 0, command, command + 111];

export const controllerBuilder = async (deviceData: IDeviceData, bleDevice: IBLEDevice) => {
  const { getCharacteristic } = bleDevice;

  for (const { serviceUuid, writeCharacteristicUuid } of supportedBeds) {
    const characteristic = await getCharacteristic(serviceUuid, writeCharacteristicUuid, false);
    if (!characteristic) continue;
    return new BLEController(deviceData, bleDevice, characteristic.handle, buildCommand);
  }

  return undefined;
};
