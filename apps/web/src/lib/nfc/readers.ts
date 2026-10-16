/**
 * The browser side of NFC reading. Every way of reading a card sits behind the same small interface, so the rest of the
 * application never knows which hardware produced a tap, and a reader can be changed without touching it.
 *
 * What a browser can really do (stated here so nobody assumes otherwise):
 *  - WEB_NFC: Chrome on Android only, over HTTPS (or localhost), with NFC switched on. No desktop browser, no iPhone.
 *  - KEYBOARD_WEDGE: a USB reader that is set to type what it reads. Most USB NFC readers are PC/SC devices and
 *    do not do this; a browser cannot talk to a PC/SC reader directly.
 *  - PC/SC readers, vendor SDKs and Android apps need a small local program (a "bridge") that posts reads to the
 *    server with the reader's secret. That path does not run in the browser and is described in docs/nfc-hardware.md.
 *  - MOCK: a labelled test double. A read from it is flagged simulated and never counts as a real card.
 */

export type AdapterId = 'WEB_NFC' | 'KEYBOARD_WEDGE' | 'MOCK';

export interface NfcRead {
  /** The NDEF payload (usually the verification URL) or null when the tag held none that we could read. */
  payload: string | null;
  /** The chip serial number as hex, when the adapter can see it. */
  serial: string | null;
  simulated: boolean;
}

export interface Availability {
  ok: boolean;
  /** Plain-language reason shown when not ok, and a note about what the adapter needs when ok. */
  reason: string;
}

export interface NfcAdapter {
  id: AdapterId;
  label: string;
  simulated: boolean;
  availability(): Availability;
  /** Starts listening. Resolves once listening has begun; reads and errors arrive through the callbacks. */
  start(onRead: (r: NfcRead) => void, onError: (message: string) => void): Promise<void>;
  stop(): void;
  /** Writing a record to a chip. Only some adapters can. */
  write?(url: string): Promise<void>;
}

// ------------------------------------------------------------------------------------------------ Web NFC

interface NdefRecordLike { recordType: string; data?: DataView; encoding?: string }
interface NdefReadingEventLike extends Event { serialNumber: string; message: { records: NdefRecordLike[] } }
interface NdefReaderLike extends EventTarget {
  scan(options?: { signal?: AbortSignal }): Promise<void>;
  write(message: { records: { recordType: string; data: string }[] }, options?: { signal?: AbortSignal; overwrite?: boolean }): Promise<void>;
}
type NdefReaderCtor = new () => NdefReaderLike;
const ndefCtor = (): NdefReaderCtor | undefined => (typeof window === 'undefined' ? undefined : (window as unknown as { NDEFReader?: NdefReaderCtor }).NDEFReader);

function friendlyNfcError(e: unknown): string {
  const name = e instanceof Error ? e.name : '';
  if (name === 'NotAllowedError') return 'NFC permission was refused. Allow NFC for this site in the browser, and make sure NFC is switched on in the phone settings.';
  if (name === 'NotSupportedError') return 'This device does not support NFC reading.';
  if (name === 'NotReadableError') return 'The phone could not read that card. Hold it flat against the back of the phone and try again.';
  if (name === 'AbortError') return 'Reading was stopped.';
  return e instanceof Error ? e.message : 'The NFC reader reported an unknown error.';
}

export const webNfcAdapter = (): NfcAdapter => {
  let controller: AbortController | null = null;
  return {
    id: 'WEB_NFC',
    label: 'This phone (Web NFC)',
    simulated: false,
    availability() {
      if (!ndefCtor()) return { ok: false, reason: 'Web NFC is not available in this browser. It works only in Chrome on an Android phone with NFC. Use a registered reader through the bridge, or another way of checking.' };
      if (typeof window !== 'undefined' && !window.isSecureContext) return { ok: false, reason: 'Web NFC needs a secure (HTTPS) connection.' };
      return { ok: true, reason: 'Hold a card against the back of the phone. Reads the address stored on the chip.' };
    },
    async start(onRead, onError) {
      const Ctor = ndefCtor();
      if (!Ctor) throw new Error('Web NFC is not available.');
      controller?.abort();
      controller = new AbortController();
      const reader = new Ctor();
      reader.addEventListener('readingerror', () => onError('A card was detected but its data could not be read. Try again.'));
      reader.addEventListener('reading', (ev) => {
        const e = ev as NdefReadingEventLike;
        let payload: string | null = null;
        for (const rec of e.message.records) {
          if ((rec.recordType === 'url' || rec.recordType === 'text') && rec.data) {
            payload = new TextDecoder(rec.encoding ?? 'utf-8').decode(rec.data);
            break;
          }
        }
        onRead({ payload, serial: e.serialNumber ? e.serialNumber.replace(/:/g, '').toUpperCase() : null, simulated: false });
      });
      try {
        await reader.scan({ signal: controller.signal });
      } catch (err) {
        throw new Error(friendlyNfcError(err));
      }
    },
    stop() {
      controller?.abort();
      controller = null;
    },
    async write(url) {
      const Ctor = ndefCtor();
      if (!Ctor) throw new Error('Web NFC is not available.');
      try {
        await new Ctor().write({ records: [{ recordType: 'url', data: url }] }, { overwrite: true });
      } catch (err) {
        throw new Error(friendlyNfcError(err));
      }
    },
  };
};

// ------------------------------------------------------------------------------------------------ keyboard wedge

/**
 * A USB reader configured to "type" what it reads, ending with Enter. It cannot be told apart from a person typing, so
 * only fast, complete lines that look like our address or reference are treated as a read.
 */
export const keyboardWedgeAdapter = (): NfcAdapter => {
  let handler: ((e: KeyboardEvent) => void) | null = null;
  return {
    id: 'KEYBOARD_WEDGE',
    label: 'USB reader that types (keyboard mode)',
    simulated: false,
    availability: () => ({ ok: true, reason: 'Only for readers set to type what they read, followed by Enter. Click on this page first so it receives the typing.' }),
    async start(onRead) {
      let buffer = '';
      let last = 0;
      handler = (e) => {
        const now = Date.now();
        if (now - last > 120) buffer = ''; // a reader types in a burst; a person does not
        last = now;
        if (e.key === 'Enter') {
          const value = buffer.trim();
          buffer = '';
          if (value.length >= 22) onRead({ payload: value, serial: null, simulated: false });
          return;
        }
        if (e.key.length === 1) buffer += e.key;
      };
      window.addEventListener('keydown', handler);
    },
    stop() {
      if (handler) window.removeEventListener('keydown', handler);
      handler = null;
    },
  };
};

// ------------------------------------------------------------------------------------------------ mock

/** A test double. It reads nothing from a real card: reads are triggered by hand with `trigger`. */
export const mockAdapter = (): NfcAdapter & { trigger(payload: string): void } => {
  let sink: ((r: NfcRead) => void) | null = null;
  return {
    id: 'MOCK',
    label: 'MOCK reader (for tests only — reads no real card)',
    simulated: true,
    availability: () => ({ ok: true, reason: 'Simulation only. Every result it produces is marked SIMULATED and is not proof that any real card or reader works.' }),
    async start(onRead) {
      sink = onRead;
    },
    stop() {
      sink = null;
    },
    async write() {
      /* nothing is written anywhere */
    },
    trigger(payload) {
      sink?.({ payload, serial: null, simulated: true });
    },
  };
};

export const ADAPTER_HELP: Record<string, string> = {
  WEB_NFC: 'Chrome on an NFC-capable Android phone, over HTTPS. Reads and writes NDEF records.',
  KEYBOARD_WEDGE: 'A USB reader set to keyboard output. Reads only; most USB NFC readers are not this kind.',
  PCSC_BRIDGE: 'A PC/SC USB reader plus the local bridge program on that computer. Needs the reader driver. Not yet tested on hardware.',
  VENDOR_SDK: 'The reader maker’s SDK feeding the bridge address. Not yet tested on hardware.',
  ANDROID_APP: 'A companion Android app. Not built yet.',
  MOCK: 'Test double. No real card is read.',
};
