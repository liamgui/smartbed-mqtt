import { IMQTTConnection } from '@mqtt/IMQTTConnection';
import { buildDictionary } from '@utils/buildDictionary';
import { logError, logInfo, logWarn } from '@utils/logger';
import { setupDeviceInfoSensor } from 'BLE/setupDeviceInfoSensor';
import { buildMQTTDeviceData } from 'Common/buildMQTTDeviceData';
import { IESPConnection } from 'ESPHome/IESPConnection';
import { Features } from './Features';
import { buildController } from './buildController';
import { RichmatDevice, getDevices } from './options';
import { remoteFeatures } from './remoteFeatures';
import { setupMassageButtons } from './setupMassageButtons';
import { setupPresetButtons } from './setupPresetButtons';
import { setupUnderBedLightButton } from './setupUnderBedLightButton';
import { setupMotorEntities } from './setupMotorEntities';

const buildCommandBuilder = (commandProtocol?: RichmatDevice['commandProtocol']) => {
  switch (commandProtocol) {
    case 'single':
    case 'nordic':
      return (command: number) => [command & 0xff];
    case 'prefix55': {
      const prefix = [0x55, 0x01, 0x00];
      return (command: number) => {
        const checksum = (command + prefix[0] + prefix[1]) & 0xff;
        return [...prefix, command & 0xff, checksum];
      };
    }
    case 'prefixaa': {
      const prefix = [0xaa, 0x01, 0x00];
      return (command: number) => {
        const checksum = (command + prefix[0] + prefix[1]) & 0xff;
        return [...prefix, command & 0xff, checksum];
      };
    }
    case 'wilinke':
    default:
      return (command: number) => [110, 1, 0, command & 0xff, (command + 111) & 0xff];
  }
};

export const richmat = async (mqtt: IMQTTConnection, esphome: IESPConnection) => {
  const devices = getDevices();
  if (!devices.length) return logInfo('[Richmat] No devices configured');

  const devicesMap = buildDictionary(devices, (device) => ({ key: device.name.toLowerCase(), value: device }));
  const deviceNames = Object.keys(devicesMap);
  if (deviceNames.length !== devices.length) return logError('[Richmat] Duplicate name detected in configuration');
  const bleDevices = await esphome.getBLEDevices(deviceNames);
  for (const bleDevice of bleDevices) {
    const { name, mac, address, connect, disconnect } = bleDevice;
    const configuredDevice = devicesMap[mac] || devicesMap[name.toLowerCase()];

    if (!configuredDevice) {
      logInfo(`[Richmat] Device not found in configuration for MAC: ${mac} or Name: ${name}`);
      continue;
    }
    const { remoteCode, motorPulseCount, motorPulseDelayMs, ...device } = configuredDevice;

    const features = remoteFeatures[remoteCode];
    if (!features) {
      logWarn('[Richmat] Remote code not supported, please contact me on Discord', remoteCode);
      continue;
    }

    // Only override the frame format when the user asked for a specific protocol - otherwise let
    // each controller variant apply its own default (Nordic sends a bare byte, WiLinke a 5-byte
    // frame), which is what variant detection is for.
    const { commandProtocol } = device;
    const commandBuilder = commandProtocol ? buildCommandBuilder(commandProtocol) : undefined;
    if (commandProtocol) logInfo('[Richmat] Using command protocol for device:', name, commandProtocol);

    const deviceData = buildMQTTDeviceData({ ...device, address }, 'Richmat');
    try {
      await connect();
    } catch (error) {
      logWarn('[Richmat] Failed to connect to device:', name, error);
      continue;
    }

    const controller = await buildController(deviceData, bleDevice, commandBuilder);
    if (!controller) {
      await disconnect();
      continue;
    }

    if (!device.stayConnected) await disconnect();

    const hasFeature = (feature: Features) => (features & feature) === feature;
    logInfo('[Richmat] Setting up entities for device:', name);
    setupPresetButtons(mqtt, controller, hasFeature);
    setupMassageButtons(mqtt, controller, hasFeature);
    setupUnderBedLightButton(mqtt, controller, hasFeature);
    setupMotorEntities(mqtt, controller, hasFeature, { motorPulseCount, motorPulseDelayMs });

    const deviceInfo = await bleDevice.getDeviceInfo();
    if (deviceInfo) setupDeviceInfoSensor(mqtt, controller, deviceInfo);
  }
};
