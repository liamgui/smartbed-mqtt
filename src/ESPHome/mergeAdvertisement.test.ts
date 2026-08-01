import { mergeAdvertisement, newAdvertisement } from './mergeAdvertisement';
import { BLEAdvertisement, BLEData } from './types/BLEAdvertisement';

const NORDIC_UART = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';

const buildData = (uuid: string, bytes: number[]): BLEData => ({
  uuid,
  legacyDataList: new Uint8Array(bytes),
  data: '',
});

const buildAdvertisement = (advertisement: Partial<BLEAdvertisement> = {}): BLEAdvertisement => ({
  name: '',
  address: 95985339475591,
  rssi: -60,
  addressType: 0,
  manufacturerDataList: [],
  serviceDataList: [],
  serviceUuidsList: [],
  ...advertisement,
});

describe(newAdvertisement.name, () => {
  it('copies the lists so the source is not mutated', () => {
    const source = buildAdvertisement({ serviceUuidsList: [NORDIC_UART] });

    const result = newAdvertisement(source);
    result.serviceUuidsList.push('other');
    result.manufacturerDataList.push(buildData('0000ffff-0000-1000-8000-00805f9b34fb', [1]));

    expect(source.serviceUuidsList).toEqual([NORDIC_UART]);
    expect(source.manufacturerDataList).toEqual([]);
  });

  it('normalizes missing lists', () => {
    const source = {
      name: 'QRRM150966',
      address: 1,
      rssi: -60,
      addressType: 0,
    } as BLEAdvertisement;

    const result = newAdvertisement(source);

    expect(result.manufacturerDataList).toEqual([]);
    expect(result.serviceDataList).toEqual([]);
    expect(result.serviceUuidsList).toEqual([]);
  });
});

describe(mergeAdvertisement.name, () => {
  it('merges service uuids from a later packet into a named packet', () => {
    const target = newAdvertisement(buildAdvertisement({ name: 'QRRM150966' }));

    mergeAdvertisement(target, buildAdvertisement({ serviceUuidsList: [NORDIC_UART] }));

    expect(target.name).toEqual('QRRM150966');
    expect(target.serviceUuidsList).toEqual([NORDIC_UART]);
  });

  it('merges a name from a later packet into an unnamed packet', () => {
    const target = newAdvertisement(buildAdvertisement({ serviceUuidsList: [NORDIC_UART] }));

    mergeAdvertisement(target, buildAdvertisement({ name: 'QRRM150966' }));

    expect(target.name).toEqual('QRRM150966');
    expect(target.serviceUuidsList).toEqual([NORDIC_UART]);
  });

  it('does not repeat service uuids already seen', () => {
    const target = newAdvertisement(buildAdvertisement({ serviceUuidsList: [NORDIC_UART] }));

    mergeAdvertisement(target, buildAdvertisement({ serviceUuidsList: [NORDIC_UART, 'other'] }));

    expect(target.serviceUuidsList).toEqual([NORDIC_UART, 'other']);
  });

  it('keeps the longest name', () => {
    const target = newAdvertisement(buildAdvertisement({ name: 'QRRM150966' }));

    mergeAdvertisement(target, buildAdvertisement({ name: 'QRRM' }));

    expect(target.name).toEqual('QRRM150966');
  });

  it('does not overwrite the name with an empty one', () => {
    const target = newAdvertisement(buildAdvertisement({ name: 'QRRM150966' }));

    mergeAdvertisement(target, buildAdvertisement());

    expect(target.name).toEqual('QRRM150966');
  });

  it('replaces manufacturer data for a uuid already seen', () => {
    const target = newAdvertisement(buildAdvertisement({ manufacturerDataList: [buildData('uuid', [88, 80])] }));

    mergeAdvertisement(target, buildAdvertisement({ manufacturerDataList: [buildData('uuid', [88, 80, 5, 0])] }));

    expect(target.manufacturerDataList).toEqual([buildData('uuid', [88, 80, 5, 0])]);
  });

  it('keeps existing manufacturer data when the new payload is empty', () => {
    const target = newAdvertisement(buildAdvertisement({ manufacturerDataList: [buildData('uuid', [88, 80])] }));

    mergeAdvertisement(target, buildAdvertisement({ manufacturerDataList: [buildData('uuid', [])] }));

    expect(target.manufacturerDataList).toEqual([buildData('uuid', [88, 80])]);
  });

  it('appends manufacturer data for a new uuid', () => {
    const target = newAdvertisement(buildAdvertisement({ manufacturerDataList: [buildData('first', [1])] }));

    mergeAdvertisement(target, buildAdvertisement({ manufacturerDataList: [buildData('second', [2])] }));

    expect(target.manufacturerDataList).toEqual([buildData('first', [1]), buildData('second', [2])]);
  });

  it('merges service data', () => {
    const target = newAdvertisement(buildAdvertisement({ name: 'QRRM150966' }));

    mergeAdvertisement(target, buildAdvertisement({ serviceDataList: [buildData('uuid', [1, 2])] }));

    expect(target.serviceDataList).toEqual([buildData('uuid', [1, 2])]);
  });

  it('takes the newest rssi', () => {
    const target = newAdvertisement(buildAdvertisement({ rssi: -60 }));

    mergeAdvertisement(target, buildAdvertisement({ rssi: -72 }));

    expect(target.rssi).toEqual(-72);
  });

  it('keeps the address type from the first packet', () => {
    const target = newAdvertisement(buildAdvertisement({ addressType: 1 }));

    mergeAdvertisement(target, buildAdvertisement({ addressType: 0 }));

    expect(target.addressType).toEqual(1);
  });
});
