/*
 * Guards the patch in patches/@2colors+esphome-native-api+1.3.6.patch.
 *
 * The upstream library gets GATT UUID decoding wrong in two independent ways, and both
 * of them present identically at runtime: every integration fails with "Could not find
 * expected service/characteristic". If a version bump ever drops the patch, this test
 * fails instead of the beds going silent.
 *
 *   1. ESPHome 2025.8+ (API v1.12+) reports 16-/32-bit UUIDs in the new `short_uuid`
 *      field and leaves `uuid` empty. The stock mapper only reads `uuid`.
 *   2. The generated api_pb.js reads the 128-bit `uuid` field as JS numbers, which
 *      silently rounds anything above 2^53. It must use the *String reader variants.
 *
 * These modules are internal to the package and have no type declarations, hence the
 * requires.
 */
/* eslint-disable @typescript-eslint/no-var-requires */
const { pb } = require('@2colors/esphome-native-api/lib/utils/messages');
const { mapMessageByType } = require('@2colors/esphome-native-api/lib/utils/mapMessageByType');

interface MappedService {
  uuid: string;
  characteristicsList: { uuid: string }[];
}

// Round-trips through the wire format so the generated reader is genuinely exercised.
const decodeServices = (build: (response: any) => void): MappedService[] => {
  const response = new pb.BluetoothGATTGetServicesResponse();
  response.setAddress(1);
  build(response);
  const bytes = response.serializeBinary();
  const parsed = pb.BluetoothGATTGetServicesResponse.deserializeBinary(bytes);
  return mapMessageByType('BluetoothGATTGetServicesResponse', parsed.toObject()).servicesList;
};

describe('GATT UUID decoding', () => {
  it('expands 16-bit short_uuid to the full 128-bit form', () => {
    const services = decodeServices((response) => {
      const service = new pb.BluetoothGATTService();
      service.setHandle(1);
      service.setShortUuid(0xffe0);
      const characteristic = new pb.BluetoothGATTCharacteristic();
      characteristic.setHandle(11);
      characteristic.setShortUuid(0xffe9);
      service.addCharacteristics(characteristic);
      response.setServicesList([service]);
    });

    expect(services[0].uuid).toBe('0000ffe0-0000-1000-8000-00805f9b34fb');
    expect(services[0].characteristicsList[0].uuid).toBe('0000ffe9-0000-1000-8000-00805f9b34fb');
  });

  it('decodes 128-bit uuids without losing precision', () => {
    const services = decodeServices((response) => {
      const service = new pb.BluetoothGATTService();
      service.setHandle(2);
      service.setUuidList([String(0x6e400001b5a3f393n), String(0xe0a9e50e24dcca9en)]);
      const characteristic = new pb.BluetoothGATTCharacteristic();
      characteristic.setHandle(22);
      characteristic.setUuidList([String(0x6e400002b5a3f393n), String(0xe0a9e50e24dcca9en)]);
      service.addCharacteristics(characteristic);
      response.setServicesList([service]);
    });

    expect(services[0].uuid).toBe('6e400001-b5a3-f393-e0a9-e50e24dcca9e');
    expect(services[0].characteristicsList[0].uuid).toBe('6e400002-b5a3-f393-e0a9-e50e24dcca9e');
  });
});
