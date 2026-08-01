# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Home Assistant add-on (Node 18 + TypeScript, no framework) that exposes adjustable smart beds to Home Assistant
over MQTT discovery. One process serves exactly one integration `type` — chosen by config, dispatched in
`src/index.ts`. Integrations reach beds over cloud HTTP (Sleeptracker, ErgoWifi), local TCP/HTTP/UDP (ErgoMotion,
Logicdata), or BLE via an ESPHome Bluetooth proxy (everything else).

## Commands

```bash
yarn install
yarn build          # tsc -p tsconfig.build.json && tsc-alias  (tsc-alias rewrites @ha/@mqtt/@utils in emitted JS — build is broken without it)
yarn build:ci       # clean + build (what CI runs)
yarn lint           # eslint src/ --max-warnings=0  — warnings fail
yarn prettier       # write formatting (printWidth 120, single quotes)
yarn test           # jest --watch
yarn test:ci        # jest, single pass
yarn jest src/HomeAssistant/Button.test.ts     # one file
yarn jest -t 'publishes discovery'             # one test by name
yarn start          # ts-node src/index.ts
yarn docker:dev     # build image, run with ../data mounted at /data
```

Node version is pinned by `.nvmrc` (v18). Husky pre-commit runs `lint-staged` (eslint + prettier).

## Runtime configuration contract

`src/Utils/options.ts` does a **synchronous `readFileSync('../data/options.json')` at module load**. In the add-on
that file is written by Home Assistant; locally you need a sibling `data/options.json` outside the repo (i.e.
`../data/options.json` relative to the repo root — mirror the `options` block of `config.json`). Any module that
transitively imports `@utils/options` — which is every integration's `options.ts` — throws on import without it.
That is why tests only cover leaf utils and HomeAssistant entities.

MQTT credentials come from env (`MQTTHOST`, `MQTTPORT`, `MQTTUSER`, `MQTTPASSWORD`), set by `run.sh` via bashio
from the add-on config, with auto-detection of the Mosquitto service.

`config.json` is the add-on manifest: `options` are the defaults users see and `schema` validates them. Each
integration's `options.ts` declares a TS interface over its own slice of that JSON — **the two are only kept in
sync by hand**, so a new/renamed config field means editing `config.json` (options *and* schema), the feature's
`options.ts`, the README section, and CHANGELOG.

## Layering

**Bootstrap** (`src/index.ts`) — `loadStrings()` → `connectToMQTT()` → switch on `getType()`. Cloud/local-network
types return before the ESPHome connection is made; BLE types fall through to `connectToESPHome()` and a second
switch. Adding an integration means touching both the `Type` union in `src/Utils/options.ts` and this file.

**Transport**
- `src/MQTT/MQTTConnection.ts` — an `EventEmitter` over mqtt.js where *the topic is the event name*; publishes
  JSON-stringify objects at qos 1 and tracks subscriptions to avoid duplicates.
- `src/ESPHome/` — `ESPConnection` holds one `@2colors/esphome-native-api` `Connection` per configured proxy.
  `getBLEDevices(names)` subscribes to advertisements and resolves once every configured name/MAC is seen
  (case-insensitive; matches on either). `BLEDevice` implements the GATT surface in
  `ESPHome/types/IBLEDevice.ts` with service/characteristic caching, and reconnects when the proxy reports a
  connection state change.

**Controller** (`src/Common/IController.ts`) — the seam every integration shares:
`writeCommand`/`writeCommands`/`cancelCommands`, plus `deviceData` (MQTT topic + HA device block) and a `cache`
bag. `src/BLE/BLEController.ts` is the generic BLE implementation: constructed with a characteristic handle, a
`commandBuilder: (TCommand) => number[]`, and optional `notifyHandles`; it re-emits notifications as events keyed
by notify name, deduping identical consecutive payloads. It auto-disconnects 60s after the last write **unless**
`stayConnected` — and subscribing to any notify handle implies `stayConnected`. Non-BLE integrations supply their
own `Controller.ts` (`ErgoMotion` opens a TCP socket per command; `Logicdata`, `ErgoWifi`, `Sleeptracker` use
HTTP request modules under `requests/`).

**Repeat & cancel semantics** (`src/Utils/Timer.ts` + `loopWithWait`) — `writeCommand(cmd, count, waitTime)`
repeats a command on an interval. If the same command list is already running, the existing timer's count is
*extended* rather than restarted; a different command cancels first. This is what makes held HA cover buttons
behave: motor `setup*Entities` modules send e.g. `writeCommand(cmd, 25, 200)` on OPEN/CLOSE and a stop command on
STOP, tracking direction in `cache.motorState` with a `Cancelable` flag to resolve races.

**Entities** (`src/HomeAssistant/`) — `base/Entity.ts` derives every topic from `deviceData.deviceTopic` +
`safeId(description)`, publishes its discovery config shortly after construction, and re-publishes 15s after any
`homeassistant/status: online`. `StatefulEntity` adds state publishing; `Cover`, `PositionalCover`, `Button`,
`Switch`, `Light`, `Select`, `NumberSlider`, `Sensor`, `JsonSensor` build on those.

**Feature setup** — `setup*Buttons` / `setup*Entities` modules take `(mqtt, controller)` and stash created
entities in `controller.cache` under a key, returning early if the key is set. Keep this idempotent: Sleeptracker
re-runs its processors on every poll, and helpers like `Common/buildCommandButton.ts` rely on the guard.

## Per-integration conventions

```
src/<Name>/
  <name>.ts            # entrypoint: (mqtt, esphome?) => Promise<void>
  options.ts           # device interface + getDevices() over getRootOptions()
  setup*.ts            # entity builders
  <Variant>/isSupported.ts + controllerBuilder.ts    # for multi-controller hardware
```

The BLE entrypoints (`Keeson`, `Richmat`, `Reverie`, `LeggettPlatt`, …) are deliberately near-identical: build a
lowercase name→device dictionary, bail on duplicate names, `esphome.getBLEDevices()`, then pick a controller
builder via **parallel `checks` / `controllerBuilders` arrays where index correspondence is the coupling** —
`checks.map((check, i) => check(dev) ? controllerBuilders[i] : undefined)`. Unsupported devices get a `logWarn`
dumping name/address/`manufacturerDataList`/`serviceUuidsList` and pointing at Discord; follow that pattern rather
than throwing. Prefix all logs with `[Name]`.

User-visible entity names must come from `src/Strings/en.ts` via `buildEntityConfig(key, { icon, category })` —
`StringsKey` is `keyof typeof strings`, so a new label is a compile error until the key is added there.

Capability handling differs by vendor and is worth matching to the hardware: Richmat and Okimat map a
user-supplied `remoteCode` to a bitmask (`Features.ts` + `remoteFeatures.ts` / `supportedRemotes.ts`), while Octo
queries the bed for its feature list at startup and Sleeptracker reads `productFeatures`/`capabilities` from the
API. Prefer runtime detection when the device offers it.

### Adding a bed integration

1. `src/<Name>/options.ts`, `src/<Name>/<name>.ts`, variant `isSupported`/`controllerBuilder`, `setup*` modules.
2. New labels into `src/Strings/en.ts`.
3. New value in the `Type` union (`src/Utils/options.ts`) **and** the matching `switch` case in `src/index.ts`
   (cloud/local before the ESPHome connect, BLE after).
4. `config.json`: `options` sample, `schema` entry, and the new value in the `type` list.
5. README section (configuration keys + feature list) and a CHANGELOG entry.

### Reverse-engineering new hardware

Set `type: scanner`. With `scannerDevices` entries it connects (optionally pairs), enumerates GATT services and
characteristics with decoded property flags, reads every readable characteristic as base64/ascii/raw, and dumps
the lot as JSON. With an empty list it logs every named advertisement it sees. This is the intended first step
for a new controller — see `src/Scanner/scanner.ts`.

## Testing

Jest + ts-jest, path aliases mapped from `tsconfig.json` in `jest.config.ts`. Coverage is narrow by design:
HomeAssistant entities and pure utils. Entity tests use `jest-mock-extended`'s `mock<IMQTTConnection>()` plus
`testDevice`/`mocked` from `src/Utils/testHelpers.ts`, and **must** use `jest.useFakeTimers()` + `runAllTimers()`
because discovery and availability publishes are deferred through `setTimeout`. Assert on the exact discovery
topic and payload — that is the contract with Home Assistant.

## Release bookkeeping

The version appears in three files that must agree: `package.json`, `config.json`, and the `io.hass.version`
label in `Dockerfile`. `CHANGELOG.md` groups entries under `## vX.Y.Z` → `**New Features**` / `**Bug Fixes**`
with `(Area) message` lines matching the commit-message style (`(Keeson) Send stop command after movement
commands`). Pushing to `main` builds and pushes the ghcr image; PRs to `main` run `build:ci` + `test:ci`.

## Style notes

Strict TS is on with `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, and
`noFallthroughCasesInSwitch`; lint fails on any warning, including `@typescript-eslint/no-floating-promises`
(hence the `void`/`await` on fire-and-forget calls). `no-explicit-any` is disabled in eslint but avoid `any`
anyway. Prefer arrow-function class properties and destructured controller params, as the existing modules do.
