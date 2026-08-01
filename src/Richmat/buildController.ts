import { IDeviceData } from '@ha/IDeviceData';
import { logInfo, logWarn } from '@utils/logger';
import { IBLEDevice } from 'ESPHome/types/IBLEDevice';
import { controllerBuilder as nordicControllerBuilder } from './Nordic/controllerBuilder';
import { isSupported as isNordicSupported } from './Nordic/isSupported';
import { controllerBuilder as wiLinkeControllerBuilder } from './WiLinke/controllerBuilder';
import { isSupported as isWiLinkeSupported } from './WiLinke/isSupported';

const variants = [
  { variant: 'Nordic', isSupported: isNordicSupported, controllerBuilder: nordicControllerBuilder },
  { variant: 'WiLinke', isSupported: isWiLinkeSupported, controllerBuilder: wiLinkeControllerBuilder },
];

const logUnsupported = async (bleDevice: IBLEDevice) => {
  const {
    name,
    address,
    advertisement: { manufacturerDataList, serviceUuidsList },
  } = bleDevice;

  let servicesList: { uuid: string; characteristicsList: string[] }[] | undefined;
  try {
    servicesList = (await bleDevice.getServices()).map(({ uuid, characteristicsList }) => ({
      uuid,
      characteristicsList: characteristicsList.map((characteristic) => characteristic.uuid),
    }));
  } catch (err) {
    logWarn('[Richmat] Could not enumerate services for device:', name, err);
  }

  logWarn(
    '[Richmat] Device not supported, please contact me on Discord',
    name,
    JSON.stringify({ name, address, manufacturerDataList, serviceUuidsList, servicesList })
  );
};

export const buildController = async (deviceData: IDeviceData, bleDevice: IBLEDevice) => {
  const { name } = bleDevice;

  const advertised = variants.filter(({ isSupported }) => isSupported(bleDevice));
  for (const { variant, controllerBuilder } of advertised) {
    const controller = await controllerBuilder(deviceData, bleDevice);
    if (controller) return controller;
    logInfo('[Richmat] Advertised variant does not match the device services:', variant, name);
  }

  // A device can be found via an advertising packet that carries no service uuids at all, which
  // leaves the checks above with nothing to match on. Fall back to probing the services the device
  // actually exposes - each controller builder verifies its own write characteristic exists, and the
  // variants use disjoint services, so this cannot pick the wrong protocol.
  const remaining = variants.filter((variant) => !advertised.includes(variant));
  for (const { variant, controllerBuilder } of remaining) {
    const controller = await controllerBuilder(deviceData, bleDevice);
    if (!controller) continue;
    logInfo('[Richmat] Detected variant from device services:', variant, name);
    return controller;
  }

  await logUnsupported(bleDevice);
  return undefined;
};
