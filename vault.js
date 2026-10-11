// GenPass vault v2: Argon2id (hash-wasm, 64 MiB) -> AES-256-GCM + AAD.
// Chay trong popup / service worker (co crypto.subtle) va trong Node (test).
//
// Vendor Argon2id (hash-wasm, MIT) bat buoc cho KDF:
//   source: https://cdn.jsdelivr.net/npm/hash-wasm@4.12.0/dist/index.umd.js
//   pkg:    hash-wasm@4.12.0 (MIT, (c) Dani Biro, https://www.npmjs.com/package/hash-wasm)
//   file:   vendor/hash-wasm.umd.js  (283696 bytes)
//   sha256: 4c623029dcde56c12ae2dc290f90e616cfeb4734e23575bb08c01cdeac3acbe3
// Vendor chay nhu script thi dat globalThis.hashwasm (chu thuong, xem factory
// UMD); trong Node thi require() tra ve doi tuong co argon2id. Neu thieu vendor
// moi KDF se nem Error("GPVAULT_NO_KDF").
(function (global) {
  "use strict";

  var KDF_NAME = "argon2id";
  var PARAMS = { iterations: 3, memorySize: 65536, parallelism: 4, hashLength: 32 };
  // 64 MiB, OWASP baseline; hash-wasm memorySize tinh bang KiB
  var AAD = new TextEncoder().encode("genpass-vault|v2|aes-256-gcm");
  // giam dinh blob, chong trao/rollback: moi GCM encrypt/decrypt deu gom chuoi nay

  var IV_LEN = 12;
  var SALT_LEN = 16;
  var HW = null; // lib hash-wasm, resolved mot lan khi can

  function subtle() {
    if (!global.crypto || !global.crypto.subtle) throw new Error("GPVAULT_NO_SUBTLE");
    return global.crypto.subtle;
  }

  function toBytes(buf) {
    if (buf instanceof Uint8Array) return buf;
    return new Uint8Array(buf);
  }

  // Chia chunk de khong tran stack khi enumerate buffer lon
  function b64encode(buf) {
    var bytes = toBytes(buf);
    var bin = "";
    for (var i = 0; i < bytes.length; i += 8192) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    }
    return btoa(bin);
  }

  function b64decode(s) {
    var bin = atob(s);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function randomBytes(n) {
    var a = new Uint8Array(n);
    global.crypto.getRandomValues(a);
    return a;
  }

  // Tra ve lib hash-wasm mot lan. UMD global (trinh duyet) hoac require (Node).
  function kdf() {
    if (HW) return HW;
    var lib = global.hashwasm || global.hashWasm; // factory UMD dat globalThis.hashwasm
    if (!lib && typeof require === "function") {
      try {
        lib = require("./vendor/hash-wasm.umd.js");
      } catch (e) {
        lib = null; // thieu vendor -> nem GPVAULT_NO_KDF ben duoi
      }
    }
    if (!lib || typeof lib.argon2id !== "function") throw new Error("GPVAULT_NO_KDF");
    HW = lib;
    return HW;
  }

  // Argon2id tu PIN + salt -> 32 byte raw key (khong qua deriveKey cua WebCrypto)
  async function hashSecret(secret, saltBytes) {
    var lib = kdf();
    var out = await lib.argon2id({
      password: secret,
      salt: saltBytes,
      parallelism: PARAMS.parallelism,
      iterations: PARAMS.iterations,
      memorySize: PARAMS.memorySize,
      hashLength: PARAMS.hashLength,
      outputType: "binary"
    });
    return out instanceof Uint8Array ? out : new Uint8Array(out);
  }

  // Import AES-GCM key tu raw bytes hoac base64 (extractable=false, chi encrypt/decrypt)
  function importAesKey(keyOrKeyB64) {
    var raw = keyOrKeyB64 instanceof Uint8Array ? keyOrKeyB64 : b64decode(keyOrKeyB64);
    return subtle().importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  }

  function checkBlob(blob) {
    if (
      !blob ||
      blob.v !== 2 ||
      blob.kdf !== KDF_NAME ||
      typeof blob.salt !== "string" ||
      typeof blob.iv !== "string" ||
      typeof blob.ct !== "string" ||
      blob.t !== PARAMS.iterations ||
      blob.m !== PARAMS.memorySize ||
      blob.p !== PARAMS.parallelism
    ) {
      throw new Error("GPVAULT_BAD_BLOB");
    }
  }

  // AES-GCM encrypt JSON voi IV moi + AAD, gop vao blob v2 (salt truyen tu ngoai)
  async function sealBlob(dataObj, key, saltBytes) {
    var iv = randomBytes(IV_LEN); // IV moi moi lan ma hoa
    var ct = await subtle().encrypt(
      { name: "AES-GCM", iv: iv, additionalData: AAD, tagLength: 128 },
      key,
      new TextEncoder().encode(JSON.stringify(dataObj))
    );
    return {
      v: 2,
      kdf: KDF_NAME,
      t: PARAMS.iterations,
      m: PARAMS.memorySize,
      p: PARAMS.parallelism,
      salt: b64encode(saltBytes),
      iv: b64encode(iv),
      ct: b64encode(ct)
    };
  }

  async function decryptBlob(blob, keyOrKeyB64) {
    checkBlob(blob);
    // Sai key hoac data bi sua: crypto.subtle.decrypt nem OperationError, giu nguyen
    var key = await importAesKey(keyOrKeyB64);
    var raw = await subtle().decrypt(
      { name: "AES-GCM", iv: b64decode(blob.iv), additionalData: AAD, tagLength: 128 },
      key,
      b64decode(blob.ct)
    );
    return JSON.parse(new TextDecoder().decode(raw));
  }

  async function unlockWithPin(blob, secret) {
    checkBlob(blob);
    var raw = await hashSecret(secret, b64decode(blob.salt));
    var data = await decryptBlob(blob, raw);
    return { data: data, keyB64: b64encode(raw) };
  }

  async function encryptWithPin(dataObj, secret) {
    var salt = randomBytes(SALT_LEN);
    var raw = await hashSecret(secret, salt);
    var key = await importAesKey(raw);
    return sealBlob(dataObj, key, salt);
  }

  // Duong luu moi lan save: khong KDF, chi AES. salt/t/m/p copy tu blob cu (constants).
  async function reencrypt(dataObj, keyB64, meta) {
    var key = await importAesKey(keyB64);
    return sealBlob(dataObj, key, b64decode(meta.salt));
  }

  async function verifySecret(blob, secret) {
    await unlockWithPin(blob, secret);
    return true; // sai secret -> OperationError nem ra caller catch
  }

  global.GPVault = {
    KDF_NAME: KDF_NAME,
    PARAMS: PARAMS,
    b64encode: b64encode,
    b64decode: b64decode,
    randomBytes: randomBytes,
    hashSecret: hashSecret,
    encryptWithPin: encryptWithPin,
    unlockWithPin: unlockWithPin,
    reencrypt: reencrypt,
    decryptBlob: decryptBlob,
    verifySecret: verifySecret
  };

  if (typeof module !== "undefined" && module.exports) module.exports = global.GPVault;
})(typeof globalThis !== "undefined" ? globalThis : this);
