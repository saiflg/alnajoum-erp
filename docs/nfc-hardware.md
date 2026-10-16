# NFC staff cards: hardware, drivers and what is (and is not) verified

Status key used in this document and the Phase 27 report: **VERIFIED** (tested in the stated environment), **MOCKED** (tested with
a labelled test double, not a real card or reader), **BLOCKED** (cannot be tested without hardware or an account), **NOT IMPLEMENTED**.

| Capability | Status |
|---|---|
| Card record, issuance workflow (prepare, write, read back, confirm), activation gate | MOCKED - 61 live checks with simulated writes and taps |
| NDEF URI record bytes (NFC Forum short record, `U` type, `https://` prefix; Type 2 TLV for NTAG) | VERIFIED by unit tests against the published layout; **not** yet read by a real phone or reader |
| Server-side verification of a tap (status, expiry, suspension, revocation, replacement, tenant, logging) | MOCKED (the same code path real taps use) |
| Web NFC adapter (Chrome on Android) | **BLOCKED** - written to the Web NFC API, never run on a device |
| USB "keyboard" reader adapter | **BLOCKED** - never run on a device |
| PC/SC USB reader through a local bridge | Server protocol MOCKED; **the bridge program itself is NOT IMPLEMENTED** (see below) |
| Vendor SDK reader, Android companion app | NOT IMPLEMENTED |
| Cryptographic challenge-response (DESFire EV2/EV3, NTAG 424 DNA) | **NOT IMPLEMENTED** - needs the manufacturer SDK, per-card keys and key custody |

## What the system actually promises

The chip carries one random 128-bit **reference**, written as an `https://<site>/verify/nfc/<reference>` address. The reference is
**not** the QR token, so the two are checked separately. On every tap the server looks the reference up and answers from the card
record. The chip never decides anything and holds no personal data (no name, number, e-mail, passport, password or token).

An ordinary NFC tag can be copied: a copy carries the same reference and the same serial number. This system therefore labels every
NFC answer with how strong the check was (`OPAQUE_REFERENCE`, `UID_ONLY`, `QR_AND_NFC`), shows a warning, and shows the holder's
photograph so a person compares the face. **A tap is not proof of identity and must not open doors, payments or administrator
accounts.** For higher assurance use a DESFire or NTAG 424 DNA card with manufacturer-documented authentication; that is a separate
piece of work.

## Choosing hardware (do this before ordering a batch)

1. **Chip.** NTAG213/215/216 (simple, cheap, phones read them, copyable). DESFire EV2/EV3 and NTAG 424 DNA (can be protected with keys, but need the SDK). MIFARE Classic is **not recommended**.
2. **Card stock.** Printable PVC that carries that chip (13.56 MHz, ISO/IEC 14443). Ask the supplier for the exact inlay.
3. **Reader.** Check that the reader supports the chip (ISO 14443 type A), your operating system and driver, and how it reports data.
4. **Phone.** Android + Chrome over HTTPS can read and write NDEF through Web NFC. iPhones and desktop browsers cannot use Web NFC.
5. Order **3-5 samples**, write one with the admin screen, tap it with the phone and with the reader you will really use, record the outcome in *NFC & Readers, Chip types, Notes*, and only then order the batch.

Record the choice under **Staff Management, NFC & Readers**. Do not tick compatibility you have not tried.

## Reader types

| Type | What you need | Notes |
|---|---|---|
| Phone browser (Web NFC) | Android phone with NFC, Chrome, HTTPS site, NFC switched on | Reads and writes. Not iPhone. |
| USB reader that types | A reader configured to output text followed by Enter | Reads only. Most USB NFC readers are PC/SC and do **not** do this. |
| PC/SC reader + bridge | Reader driver (CCID/PC/SC, built into Windows for most), a small local bridge program | The browser cannot talk to PC/SC. The bridge reads the card and posts to the server. |
| Vendor SDK / Android app | The vendor's SDK or a companion app | Not built. |
| MOCK | Nothing | Reads no real card. Every result is marked SIMULATED. Refused in production. |

## Local bridge protocol (for whoever writes the bridge program)

Register a reader of type *PC/SC reader through the local bridge* under NFC & Readers. The screen shows a **one-time secret**
(only its hash is stored). The bridge sends it in the `x-reader-token` header.

```
POST {site}/api/v1/public/nfc/bridge/heartbeat   body {"status":"CONNECTED" | "DISCONNECTED" | "ERROR", "error":"..."}
POST {site}/api/v1/public/nfc/bridge/verify      body {"payload":"<the NDEF URI read from the card>"}
```

`verify` returns the same result object as the scanner (`result`, `label`, `staff` only when VALID, `method`, `assurance`,
`warnings`). A bridge secret can do exactly these two things. A switched-off reader is refused immediately. Both calls are rate
limited. Read the NDEF message with the reader's documented PC/SC APDUs for the chip (for NTAG: READ binary of the user pages,
parse the Type 2 TLV `03 <len> ... FE`, then the NDEF URI record); do not invent commands.

A reference implementation of the bridge is **not included** because it cannot be tested without a reader. Candidate libraries are
`nfc-pcsc` (Node) or `pyscard` (Python). Treat anything built on them as untested until it has read a real card.

## Mock reader

For automated tests and demonstrations only. It is registered like any reader, marked MOCK, produces results flagged `simulated`,
and is refused in production (both at registration and when a scan or an encoding confirmation says it is simulated).
