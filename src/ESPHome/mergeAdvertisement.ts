import { BLEAdvertisement, BLEData } from './types/BLEAdvertisement';

// ESPHome forwards each raw BLE advertising packet separately, and a device splits its data across
// them - the name typically arrives in one packet (AD type 0x08/0x09) while service UUIDs and
// manufacturer data arrive in another. Merging the packets is what lets device detection see
// everything a device advertises rather than whichever packet happened to arrive first.

export const newAdvertisement = ({
  name,
  address,
  rssi,
  addressType,
  manufacturerDataList,
  serviceDataList,
  serviceUuidsList,
}: BLEAdvertisement): BLEAdvertisement => ({
  name,
  address,
  rssi,
  addressType,
  // Copy the lists so we never mutate a packet owned by the ESPHome client, and normalize missing
  // lists so every consumer can rely on them being present.
  manufacturerDataList: [...(manufacturerDataList ?? [])],
  serviceDataList: [...(serviceDataList ?? [])],
  serviceUuidsList: [...(serviceUuidsList ?? [])],
});

const mergeDataList = (target: BLEData[], source?: BLEData[]) => {
  for (const data of source ?? []) {
    const index = target.findIndex(({ uuid }) => uuid === data.uuid);
    // Keep the freshest payload for a uuid we already have, but never let an empty one overwrite it.
    if (index === -1) target.push(data);
    else if (data.legacyDataList?.length) target[index] = data;
  }
};

// `address` and `addressType` are deliberately left alone: packets are merged per address, so they
// describe the same device, and connect() depends on the address type staying stable.
export const mergeAdvertisement = (target: BLEAdvertisement, source: BLEAdvertisement) => {
  // A short name (AD type 0x08) must not clobber the complete name (AD type 0x09).
  if (source.name && source.name.length > target.name.length) target.name = source.name;
  target.rssi = source.rssi;

  for (const uuid of source.serviceUuidsList ?? []) {
    if (!target.serviceUuidsList.includes(uuid)) target.serviceUuidsList.push(uuid);
  }
  mergeDataList(target.manufacturerDataList, source.manufacturerDataList);
  mergeDataList(target.serviceDataList, source.serviceDataList);
};
