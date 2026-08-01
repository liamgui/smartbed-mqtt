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

export const buildController = async (
  deviceData: IDeviceData,
  bleDevice: IBLEDevice,
  commandBuilder?: (command: number) => number[]
) => {
  const { name } = bleDevice;

  const advertised = variants.filter(({ isSupported }) => isSupported(bleDevice));
  for (const { variant, controllerBuilder } of advertised) {
    const controller = await controllerBuilder(deviceData, bleDevice, commandBuilder);
    if (controller) return controller;
    logInfo('[Richmat] Advertised variant does not match the device services:', variant, name);
  }

  // Only probe other variants when the advertisement identified nothing at all - which is the case
  // this exists for, since a device can be found via a packet carrying no service uuids. When the
  // advertisement did name a variant, trust it: the WiLinke builder falls back to guessing a
  // writable characteristic, and letting it guess for a bed that advertised Nordic would send that
  // bed WiLinke command frames.
  if (!advertised.length) {
    for (const { variant, controllerBuilder } of variants) {
      const controller = await controllerBuilder(deviceData, bleDevice, commandBuilder);
      if (!controller) continue;
      logInfo('[Richmat] Detected variant from device services:', variant, name);
      return controller;
    }
  }

  await logUnsupported(bleDevice);
  return undefined;
};
