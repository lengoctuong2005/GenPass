// ponytail: local storage capped at 200 items, upgrade to chrome.storage.sync or sqlite when cloud vault is required.

const CHAR_SETS = {
  upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  lower: "abcdefghijklmnopqrstuvwxyz",
  numbers: "0123456789",
  special: "!@#$%^&*()-_=+[]{}|;:,.<>?/"
};

const AMBIGUOUS_CHARS = new Set(["l", "1", "I", "|", "O", "0", "o", "B", "8"]);

// Cryptographically secure random integer in [0, max - 1] with rejection sampling (zero modulo bias)
function secureRandomInt(max) {
  if (max <= 0) return 0;
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  do {
    crypto.getRandomValues(buf);
  } while (buf[0] >= limit);
  return buf[0] % max;
}

// Fisher-Yates shuffle with CSPRNG
function secureShuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1);
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function filterAmbiguous(str) {
  return str.split("").filter(ch => !AMBIGUOUS_CHARS.has(ch)).join("");
}

// Payment Card / Banking utilities
function detectCardBrand(num) {
  const clean = (num || "").replace(/\D/g, "");
  if (/^4/.test(clean)) return { brand: "Visa", code: "visa" };
  if (/^(5[1-5]|2[2-7])/.test(clean)) return { brand: "Mastercard", code: "mastercard" };
  if (/^3[47]/.test(clean)) return { brand: "Amex", code: "amex" };
  if (/^35(2[89]|[3-8][0-9])/.test(clean)) return { brand: "JCB", code: "jcb" };
  if (/^9704/.test(clean)) return { brand: "Napas", code: "napas" };
  return { brand: "Thẻ", code: "generic" };
}

function validateLuhn(num) {
  const clean = (num || "").replace(/\D/g, "");
  if (clean.length < 12 || clean.length > 19) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let i = clean.length - 1; i >= 0; i--) {
    let digit = parseInt(clean.charAt(i), 10);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

function formatCardNumber(num) {
  const clean = (num || "").replace(/\D/g, "").slice(0, 19);
  return clean.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}

// Che sach so the, khong de lo 4 so cuoi
function maskCardNumber(num) {
  const clean = (num || "").replace(/\D/g, "");
  const masked = clean.replace(/\d/g, "•");
  return masked.replace(/(.{4})(?=.)/g, "$1 ");
}

function formatExpiryDate(val) {
  const clean = (val || "").replace(/\D/g, "").slice(0, 4);
  if (clean.length >= 3) {
    return clean.slice(0, 2) + "/" + clean.slice(2);
  }
  return clean;
}

function validateExpiryDate(expiryStr) {
  if (!expiryStr || !/^\d{2}\/\d{2}$/.test(expiryStr)) return false;
  const [mmStr, yyStr] = expiryStr.split("/");
  const mm = parseInt(mmStr, 10);
  const yy = parseInt(yyStr, 10);
  if (mm < 1 || mm > 12) return false;
  return yy >= 0 && yy <= 99;
}

function generatePassword(options) {
  const { length, upper, lower, numbers, special, avoidAmbiguous, minNumbers, minSpecial } = options;

  let upperPool = CHAR_SETS.upper;
  let lowerPool = CHAR_SETS.lower;
  let numbersPool = CHAR_SETS.numbers;
  let specialPool = CHAR_SETS.special;

  if (avoidAmbiguous) {
    upperPool = filterAmbiguous(upperPool);
    lowerPool = filterAmbiguous(lowerPool);
    numbersPool = filterAmbiguous(numbersPool);
    specialPool = filterAmbiguous(specialPool);
  }

  const activePools = [];
  const requiredChars = [];

  if (upper && upperPool.length > 0) {
    activePools.push(upperPool);
    requiredChars.push(upperPool[secureRandomInt(upperPool.length)]);
  }
  if (lower && lowerPool.length > 0) {
    activePools.push(lowerPool);
    requiredChars.push(lowerPool[secureRandomInt(lowerPool.length)]);
  }
  if (numbers && numbersPool.length > 0) {
    activePools.push(numbersPool);
    const count = Math.max(1, minNumbers || 0);
    for (let i = 0; i < count; i++) {
      requiredChars.push(numbersPool[secureRandomInt(numbersPool.length)]);
    }
  }
  if (special && specialPool.length > 0) {
    activePools.push(specialPool);
    const count = Math.max(1, minSpecial || 0);
    for (let i = 0; i < count; i++) {
      requiredChars.push(specialPool[secureRandomInt(specialPool.length)]);
    }
  }

  // Fallback to lowercase if nothing selected
  if (activePools.length === 0) {
    activePools.push(lowerPool.length > 0 ? lowerPool : CHAR_SETS.lower);
  }

  const fullPool = activePools.join("");
  const targetLength = Math.max(length, requiredChars.length);
  const result = [...requiredChars];

  while (result.length < targetLength) {
    result.push(fullPool[secureRandomInt(fullPool.length)]);
  }

  // Trim if required exceeds desired length
  if (result.length > length) {
    result.length = length;
  }

  return secureShuffle(result).join("");
}

function calculateStrength(password, poolSize) {
  if (!password || poolSize <= 1) return { score: 1, label: "Rất yếu", color: "#ef4444", pct: 15 };
  const entropy = password.length * Math.log2(poolSize);

  if (entropy < 40) return { score: 1, label: "Rất yếu", color: "#ef4444", pct: 25 };
  if (entropy < 60) return { score: 2, label: "Yếu", color: "#f59e0b", pct: 50 };
  if (entropy < 80) return { score: 3, label: "Tốt", color: "#10b981", pct: 75 };
  return { score: 4, label: "Rất mạnh", color: "#059669", pct: 100 };
}

function generatePassphrase(options = {}) {
  const {
    numWords = 4,
    separator = "-",
    capitalize = true,
    includeNumber = false
  } = options;

  const wordlist = (typeof DICEWARE_WORDS !== "undefined" && Array.isArray(DICEWARE_WORDS) && DICEWARE_WORDS.length > 0)
    ? DICEWARE_WORDS
    : ["apple", "banana", "orange", "grape"];

  const words = [];
  const count = Math.max(3, Math.min(10, numWords));

  for (let i = 0; i < count; i++) {
    const idx = secureRandomInt(wordlist.length);
    let word = wordlist[idx];
    if (capitalize) {
      word = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    } else {
      word = word.toLowerCase();
    }
    words.push(word);
  }

  if (includeNumber) {
    const randomDigit = secureRandomInt(10).toString();
    const randPos = secureRandomInt(words.length);
    words[randPos] += randomDigit;
  }

  return words.join(separator);
}

function calculatePassphraseStrength(numWords, includeNumber, wordlistSize = 1296) {
  const bitsPerWord = Math.log2(wordlistSize || 1296);
  let entropy = numWords * bitsPerWord;
  if (includeNumber) entropy += 3.32; // log2(10)

  if (entropy < 35) return { score: 1, label: "Rất yếu", color: "#ef4444", pct: 25 };
  if (entropy < 45) return { score: 2, label: "Khá", color: "#f59e0b", pct: 50 };
  if (entropy < 60) return { score: 3, label: "Mạnh", color: "#10b981", pct: 75 };
  return { score: 4, label: "Rất mạnh", color: "#059669", pct: 100 };
}

// UI Controller
document.addEventListener("DOMContentLoaded", () => {
  const els = {
    tabGen: document.getElementById("tab-gen"),
    tabHistory: document.getElementById("tab-history"),
    viewGen: document.getElementById("view-gen"),
    viewHistory: document.getElementById("view-history"),
    display: document.getElementById("password-display"),
    passwordName: document.getElementById("password-name"),
    passwordUser: document.getElementById("password-user"),
    passwordTag: document.getElementById("password-tag"),
    passwordNote: document.getElementById("password-note"),
    toggleMask: document.getElementById("btn-toggle-mask"),
    refresh: document.getElementById("btn-refresh"),
    copy: document.getElementById("btn-copy"),
    strengthBar: document.getElementById("strength-bar"),
    strengthText: document.getElementById("strength-text"),
    lengthRange: document.getElementById("length-range"),
    lengthVal: document.getElementById("length-val"),
    optUpper: document.getElementById("opt-upper"),
    optLower: document.getElementById("opt-lower"),
    optNumbers: document.getElementById("opt-numbers"),
    optSpecial: document.getElementById("opt-special"),
    optAvoidAmbiguous: document.getElementById("opt-avoid-ambiguous"),
    optAutoSavePrompt: document.getElementById("opt-autosave-prompt"),
    optAutoFill: document.getElementById("opt-autofill"),
    minNumbers: document.getElementById("min-numbers"),
    minSpecial: document.getElementById("min-special"),
    historyList: document.getElementById("history-list"),
    historyCount: document.getElementById("history-count"),
    btnClearHistory: document.getElementById("btn-clear-history"),
    btnExportCsv: document.getElementById("btn-export-csv"),
    btnImportCsv: document.getElementById("btn-import-csv"),
    inputImportCsv: document.getElementById("input-import-csv"),
    modalImportCsv: document.getElementById("modal-import-csv"),
    btnCloseImportModal: document.getElementById("btn-close-import-modal"),
    csvDropZone: document.getElementById("csv-drop-zone"),
    btnModalChooseFile: document.getElementById("btn-modal-choose-file"),
    textareaImportCsv: document.getElementById("textarea-import-csv"),
    btnModalImportText: document.getElementById("btn-modal-import-text"),
    btnOpenTabImport: document.getElementById("btn-open-tab-import"),
    btnOpenTags: document.getElementById("btn-open-tags"),
    tagFilterBar: document.getElementById("tag-filter-bar"),
    modalTags: document.getElementById("modal-tags"),
    btnCloseModal: document.getElementById("btn-close-modal"),
    inputNewTag: document.getElementById("input-new-tag"),
    btnAddTag: document.getElementById("btn-add-tag"),
    tagsManageList: document.getElementById("tags-manage-list"),
    tab2Fa: document.getElementById("tab-2fa"),
    view2Fa: document.getElementById("view-2fa"),
    count2Fa: document.getElementById("count-2fa"),
    btnScanQr: document.getElementById("btn-scan-qr"),
    btnUploadQr: document.getElementById("btn-upload-qr"),
    inputQrFile: document.getElementById("input-qr-file"),
    btnToggleAdd2Fa: document.getElementById("btn-toggle-add-2fa"),
    cardAdd2Fa: document.getElementById("card-add-2fa"),
    input2FaName: document.getElementById("input-2fa-name"),
    input2FaSecret: document.getElementById("input-2fa-secret"),
    btnSave2Fa: document.getElementById("btn-save-2fa"),
    btnCancel2Fa: document.getElementById("btn-cancel-2fa"),
    list2Fa: document.getElementById("list-2fa"),
    toast: document.getElementById("toast"),
    btnModePassword: document.getElementById("btn-mode-password"),
    btnModePassphrase: document.getElementById("btn-mode-passphrase"),
    panelModePassword: document.getElementById("panel-mode-password"),
    panelModePassphrase: document.getElementById("panel-mode-passphrase"),
    passphraseWordsRange: document.getElementById("passphrase-words-range"),
    passphraseWordsVal: document.getElementById("passphrase-words-val"),
    passphraseSeparator: document.getElementById("passphrase-separator"),
    optPassphraseCapitalize: document.getElementById("opt-passphrase-capitalize"),
    optPassphraseNumber: document.getElementById("opt-passphrase-number"),
    updateBanner: document.getElementById("update-banner"),
    updateText: document.getElementById("update-text"),
    btnViewUpdate: document.getElementById("btn-view-update"),
    btnDismissUpdate: document.getElementById("btn-dismiss-update"),
    inputSearchHistory: document.getElementById("input-search-history"),
    btnClearSearch: document.getElementById("btn-clear-search"),
    optAutoClearClipboard: document.getElementById("opt-auto-clear-clipboard"),
    tabCards: document.getElementById("tab-cards"),
    viewCards: document.getElementById("view-cards"),
    countCards: document.getElementById("count-cards"),
    btnToggleAddCard: document.getElementById("btn-toggle-add-card"),
    cardAddCard: document.getElementById("card-add-card"),
    inputCardName: document.getElementById("input-card-name"),
    inputCardHolder: document.getElementById("input-card-holder"),
    inputCardNumber: document.getElementById("input-card-number"),
    cardBrandBadge: document.getElementById("card-brand-badge"),
    inputCardExp: document.getElementById("input-card-exp"),
    inputCardCvv: document.getElementById("input-card-cvv"),
    btnToggleCardCvv: document.getElementById("btn-toggle-card-cvv"),
    inputCardEmail: document.getElementById("input-card-email"),
    inputCardPhone: document.getElementById("input-card-phone"),
    inputCardAddress: document.getElementById("input-card-address"),
    inputCardCity: document.getElementById("input-card-city"),
    inputCardState: document.getElementById("input-card-state"),
    inputCardZip: document.getElementById("input-card-zip"),
    inputCardCountry: document.getElementById("input-card-country"),
    inputCardNote: document.getElementById("input-card-note"),
    btnCancelCard: document.getElementById("btn-cancel-card"),
    btnSaveCard: document.getElementById("btn-save-card"),
    inputSearchCards: document.getElementById("input-search-cards"),
    btnClearCardsSearch: document.getElementById("btn-clear-cards-search"),
    listCards: document.getElementById("list-cards"),
    tabCookies: document.getElementById("tab-cookies"),
    viewCookies: document.getElementById("view-cookies"),
    countCookies: document.getElementById("count-cookies"),
    cookiesCurrentDomain: document.getElementById("cookies-current-domain"),
    btnToggleAddCookieProfile: document.getElementById("btn-toggle-add-cookie-profile"),
    cardSaveCookieProfile: document.getElementById("card-save-cookie-profile"),
    inputCookieProfileName: document.getElementById("input-cookie-profile-name"),
    btnCancelSaveCookieProfile: document.getElementById("btn-cancel-save-cookie-profile"),
    btnConfirmSaveCookieProfile: document.getElementById("btn-confirm-save-cookie-profile"),
    btnToggleImportCookies: document.getElementById("btn-toggle-import-cookies"),
    cardImportCookies: document.getElementById("card-import-cookies"),
    textareaImportCookiesJson: document.getElementById("textarea-import-cookies-json"),
    btnCancelImportCookies: document.getElementById("btn-cancel-import-cookies"),
    btnConfirmImportCookies: document.getElementById("btn-confirm-import-cookies"),
    btnExportCurrentCookies: document.getElementById("btn-export-current-cookies"),
    btnClearDomainCookies: document.getElementById("btn-clear-domain-cookies"),
    inputSearchCookies: document.getElementById("input-search-cookies"),
    btnClearCookiesSearch: document.getElementById("btn-clear-cookies-search"),
    cookiesFilterBar: document.getElementById("cookies-filter-bar"),
    listCookieProfiles: document.getElementById("list-cookie-profiles"),
    vaultLock: document.getElementById("vault-lock"),
    vaultPin: document.getElementById("vault-pin"),
    vaultUnlockBtn: document.getElementById("vault-unlock-btn"),
    vaultLockError: document.getElementById("vault-lock-error"),
    modalVaultPin: document.getElementById("modal-vault-pin"),
    modalVaultPinTitle: document.getElementById("modal-vault-pin-title"),
    vaultPinNew: document.getElementById("vault-pin-new"),
    vaultPinConfirm: document.getElementById("vault-pin-confirm"),
    vaultPinStrength: document.getElementById("vault-pin-strength"),
    vaultPinError: document.getElementById("vault-pin-error"),
    btnVaultPinCancel: document.getElementById("btn-vault-pin-cancel"),
    btnCloseVaultPin: document.getElementById("btn-close-vault-pin"),
    btnVaultPinSave: document.getElementById("btn-vault-pin-save"),
    modalVaultDisable: document.getElementById("modal-vault-disable"),
    vaultPinOff: document.getElementById("vault-pin-off"),
    vaultOffError: document.getElementById("vault-off-error"),
    btnVaultOffCancel: document.getElementById("btn-vault-off-cancel"),
    btnCloseVaultOff: document.getElementById("btn-close-vault-off"),
    btnVaultOffConfirm: document.getElementById("btn-vault-off-confirm"),
    optVaultEnabled: document.getElementById("opt-vault-enabled"),
    optVaultLockClose: document.getElementById("opt-vault-lock-close"),
    optVaultTimeout: document.getElementById("opt-vault-timeout"),
    vaultExtraSettings: document.getElementById("vault-extra-settings"),
    vaultStatus: document.getElementById("vault-status"),
    btnVaultChangePin: document.getElementById("btn-vault-change-pin")
  };

  let currentGenMode = "password";
  let currentSearchQuery = "";
  let clipboardClearTimer = null;
  const DEFAULT_TAGS = ["Công việc", "Cá nhân", "Mạng xã hội", "Tài chính"];
  let currentTags = [...DEFAULT_TAGS];
  let activeFilterTag = "";
  let activeCookieDomainFilter = "";
  let currentHistory = [];
  let current2FA = [];
  let currentCards = [];
  let currentCookieProfiles = [];
  let currentCookiesSearchQuery = "";
  let editingCardId = null;
  let currentCardsSearchQuery = "";
  let isCardCvvMasked = true;
  let unmaskedCardNumbers = new Set();
  let unmaskedHistoryIds = new Set();
  let tickerInterval = null;
  let currentTabUrl = "";
  let isMasked = false;

  // Che mat khau trong list lich su (mac dinh bat)
  let maskHistoryPass = true;

  // Kho ma hoa: blob, key phien (chuoi base64) va du lieu dang giai ma
  let vaultOn = false;
  let vaultBlob = null;
  let vaultKey = null; // keyB64 tho, khong con la CryptoKey
  let vaultData = {};
  let vaultDeferredCb = null;
  let vaultPinMode = "set";
  let vaultOpts = { vaultEnabled: false, vaultLockClose: true, vaultTimeoutMin: 15 };
  let vaultPort = null; // port toi SW: dong popup thi SW xoa key phien
  let vaultHeartbeat = null;

  const EYE_ON_SVG = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
  const EYE_OFF_SVG = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;

  function base32Decode(str) {
    if (!str) return new Uint8Array(0);
    const clean = str.replace(/=+$/, "").toUpperCase().replace(/\s+/g, "");
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = 0;
    let value = 0;
    const output = [];

    for (let i = 0; i < clean.length; i++) {
      const val = alphabet.indexOf(clean[i]);
      if (val === -1) continue;
      value = (value << 5) | val;
      bits += 5;

      if (bits >= 8) {
        output.push((value >>> (bits - 8)) & 255);
        bits -= 8;
      }
    }

    return new Uint8Array(output);
  }

  async function generateTotp(secretBase32, timeSec = Math.floor(Date.now() / 1000)) {
    const keyBytes = base32Decode(secretBase32);
    if (keyBytes.length === 0) return "------";

    try {
      const counter = Math.floor(timeSec / 30);
      const counterBuffer = new ArrayBuffer(8);
      const view = new DataView(counterBuffer);
      view.setBigUint64(0, BigInt(counter), false);

      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        keyBytes,
        { name: "HMAC", hash: "SHA-1" },
        false,
        ["sign"]
      );

      const signature = await crypto.subtle.sign("HMAC", cryptoKey, counterBuffer);
      const sigBytes = new Uint8Array(signature);

      const offset = sigBytes[sigBytes.length - 1] & 0x0f;
      const binary =
        ((sigBytes[offset] & 0x7f) << 24) |
        ((sigBytes[offset + 1] & 0xff) << 16) |
        ((sigBytes[offset + 2] & 0xff) << 8) |
        (sigBytes[offset + 3] & 0xff);

      const otp = binary % 1000000;
      return otp.toString().padStart(6, "0");
    } catch {
      return "------";
    }
  }

  function parseOtpAuthUrl(str) {
    if (!str || !str.startsWith("otpauth://")) return null;
    try {
      const url = new URL(str);
      if (url.protocol !== "otpauth:" || url.host !== "totp") return null;

      const pathParts = decodeURIComponent(url.pathname.replace(/^\//, "")).split(":");
      let issuer = url.searchParams.get("issuer") || "";
      let account = "";

      if (pathParts.length > 1) {
        issuer = issuer || pathParts[0];
        account = pathParts[1];
      } else {
        account = pathParts[0] || "";
      }

      const secret = url.searchParams.get("secret") || "";
      return {
        name: issuer || account || "2FA",
        account: account,
        secret: secret.trim()
      };
    } catch {
      return null;
    }
  }

  function fill2FaToActiveTab(code) {
    if (chrome?.tabs?.query) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, { action: "fill_2fa", code: code }, (response) => {
            if (chrome.runtime.lastError || !response?.success) {
              navigator.clipboard.writeText(code);
              scheduleClipboardClear(code);
              showToast("Đã sao chép mã 2FA (Không tìm thấy ô trên web)!");
            } else {
              showToast("Đã điền mã 2FA vào trang web!");
            }
          });
        }
      });
    } else {
      navigator.clipboard.writeText(code);
      scheduleClipboardClear(code);
      showToast("Đã sao chép mã 2FA!");
    }
  }

  async function decodeQrFromImage(imgElement) {
    if ("BarcodeDetector" in window) {
      try {
        const detector = new BarcodeDetector({ formats: ["qr_code"] });
        const barcodes = await detector.detect(imgElement);
        if (barcodes.length > 0 && barcodes[0].rawValue) {
          return barcodes[0].rawValue;
        }
      } catch (err) {
        console.warn("BarcodeDetector error:", err);
      }
    }

    if (typeof jsQR === "function") {
      try {
        const origWidth = imgElement.naturalWidth || imgElement.width;
        const origHeight = imgElement.naturalHeight || imgElement.height;
        if (origWidth && origHeight) {
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (ctx) {
            // Pass 1: Original image resolution
            canvas.width = origWidth;
            canvas.height = origHeight;
            ctx.drawImage(imgElement, 0, 0);
            let imgData = ctx.getImageData(0, 0, origWidth, origHeight);
            let code = jsQR(imgData.data, origWidth, origHeight, { inversionAttempts: "attemptBoth" });
            if (code && code.data) return code.data;

            // Pass 2: Downscale 50% for high-DPI / 4K captures
            if (origWidth > 1500 || origHeight > 1500) {
              const w = Math.round(origWidth * 0.5);
              const h = Math.round(origHeight * 0.5);
              canvas.width = w;
              canvas.height = h;
              ctx.drawImage(imgElement, 0, 0, w, h);
              imgData = ctx.getImageData(0, 0, w, h);
              code = jsQR(imgData.data, w, h, { inversionAttempts: "attemptBoth" });
              if (code && code.data) return code.data;
            }

            // Pass 3: Center crop for large screenshots
            if (origWidth > 900 && origHeight > 700) {
              const cropW = Math.round(origWidth * 0.7);
              const cropH = Math.round(origHeight * 0.7);
              const cropX = Math.round((origWidth - cropW) / 2);
              const cropY = Math.round((origHeight - cropH) / 2);
              canvas.width = cropW;
              canvas.height = cropH;
              ctx.drawImage(imgElement, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
              imgData = ctx.getImageData(0, 0, cropW, cropH);
              code = jsQR(imgData.data, cropW, cropH, { inversionAttempts: "attemptBoth" });
              if (code && code.data) return code.data;
            }
          }
        }
      } catch (err) {
        console.warn("jsQR decode error:", err);
      }
    }

    return null;
  }

  function handleQrScanResult(qrText) {
    if (!qrText) {
      showToast("Không tìm thấy mã QR nào!");
      return;
    }

    const trimmed = qrText.trim();
    if (trimmed.startsWith("otpauth://")) {
      const parsed = parseOtpAuthUrl(trimmed);
      if (parsed) {
        switchTab(els.tab2Fa, els.view2Fa);
        els.cardAdd2Fa.hidden = false;
        els.input2FaName.value = parsed.name + (parsed.account ? ` (${parsed.account})` : "");
        els.input2FaSecret.value = parsed.secret;
        showToast("Đã quét mã QR! Vui lòng kiểm tra và bấm Lưu.");
        return;
      }
    }

    const cleanKey = trimmed.replace(/\s+/g, "").toUpperCase();
    const isBase32Only = /^[A-Z2-7=]+$/.test(cleanKey);
    const testBytes = isBase32Only ? base32Decode(cleanKey) : [];
    if (testBytes.length >= 5) {
      switchTab(els.tab2Fa, els.view2Fa);
      els.cardAdd2Fa.hidden = false;
      els.input2FaName.value = "2FA Account";
      els.input2FaSecret.value = cleanKey;
      showToast("Đã quét mã QR! Vui lòng đặt tên và bấm Lưu.");
      return;
    }

    showToast("Mã QR không chứa thông tin 2FA hợp lệ!");
  }

  function processImageFileOrDataUrl(src, onNotFound) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = async () => {
      const qrResult = await decodeQrFromImage(img);
      if (qrResult) {
        handleQrScanResult(qrResult);
      } else if (typeof onNotFound === "function") {
        onNotFound();
      } else {
        handleQrScanResult(null);
      }
    };
    img.onerror = () => {
      if (typeof onNotFound === "function") {
        onNotFound();
      } else {
        showToast("Không thể tải hình ảnh để quét mã QR!");
      }
    };
    img.src = src;
  }

  function tryScanFromActiveTab(fallbackErrorMsg) {
    if (!chrome?.tabs?.query || !chrome?.tabs?.sendMessage) {
      showToast(fallbackErrorMsg || "Không tìm thấy mã QR nào!");
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs?.[0];
      if (!activeTab?.id || activeTab.url?.startsWith("chrome://") || activeTab.url?.startsWith("edge://")) {
        showToast(fallbackErrorMsg || "Không tìm thấy mã QR nào!");
        return;
      }

      chrome.tabs.sendMessage(activeTab.id, { action: "find_page_qr_candidates" }, async (response) => {
        if (chrome.runtime.lastError || !response) {
          showToast(fallbackErrorMsg || "Không tìm thấy mã QR nào!");
          return;
        }

        if (response.otpUrl) {
          handleQrScanResult(response.otpUrl);
          return;
        }

        if (response.secret) {
          handleQrScanResult(response.secret);
          return;
        }

        const candidates = Array.isArray(response.candidates) ? response.candidates : [];
        for (const candidateSrc of candidates) {
          const res = await new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = async () => {
              const qr = await decodeQrFromImage(img);
              resolve(qr);
            };
            img.onerror = () => resolve(null);
            img.src = candidateSrc;
          });

          if (res) {
            handleQrScanResult(res);
            return;
          }
        }

        showToast(fallbackErrorMsg || "Không tìm thấy mã QR nào trên màn hình hoặc trang web!");
      });
    });
  }

  function showToast(msg = "Đã sao chép vào bộ nhớ tạm!") {
    els.toast.textContent = msg;
    els.toast.classList.add("show");
    setTimeout(() => els.toast.classList.remove("show"), 1800);
  }

  function scheduleClipboardClear(text, seconds = 30) {
    if (!els.optAutoClearClipboard || !els.optAutoClearClipboard.checked || !text) return;
    if (clipboardClearTimer) clearTimeout(clipboardClearTimer);
    clipboardClearTimer = setTimeout(async () => {
      try {
        const current = await navigator.clipboard.readText();
        if (current === text) {
          await navigator.clipboard.writeText("");
          showToast("Đã tự động xóa bộ nhớ tạm để bảo mật!");
        }
      } catch (err) {
        console.warn("Clipboard auto-clear error:", err);
      }
    }, seconds * 1000);
  }

  function extractDomain(urlStr) {
    if (!urlStr) return "";
    try {
      const u = new URL(urlStr);
      return u.hostname.replace(/^www\./i, "");
    } catch {
      return "";
    }
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function detectActiveTab() {
    if (chrome?.tabs?.query) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0]?.url) {
          const u = tabs[0].url;
          if (u.startsWith("http://") || u.startsWith("https://")) {
            currentTabUrl = u;
            const domain = extractDomain(u);
            if (domain && !els.passwordName.value) {
              els.passwordName.value = domain;
            }
          }
        }
      });
    }
  }

  function saveTags() {
    if (chrome?.storage?.local) {
      persistKey("genTags", currentTags);
    }
  }

  function renderTags() {
    const currentSelected = els.passwordTag.value;
    els.passwordTag.innerHTML = `<option value="">Không nhãn</option>`;
    currentTags.forEach(tag => {
      const opt = document.createElement("option");
      opt.value = tag;
      opt.textContent = tag;
      if (tag === currentSelected) opt.selected = true;
      els.passwordTag.appendChild(opt);
    });
    renderTagFilterBar();
    renderTagsManageList();
  }

  function renderTagFilterBar() {
    els.tagFilterBar.innerHTML = "";

    const allChip = document.createElement("button");
    allChip.type = "button";
    allChip.className = "tag-filter-chip" + (activeFilterTag === "" ? " active" : "");
    allChip.textContent = `Tất cả (${currentHistory.length})`;
    allChip.addEventListener("click", () => {
      activeFilterTag = "";
      renderTagFilterBar();
      updateHistoryUI();
    });
    els.tagFilterBar.appendChild(allChip);

    currentTags.forEach(tag => {
      const count = currentHistory.filter(h => h.tag === tag).length;
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "tag-filter-chip" + (activeFilterTag === tag ? " active" : "");
      chip.textContent = `${tag} (${count})`;
      chip.addEventListener("click", () => {
        activeFilterTag = (activeFilterTag === tag) ? "" : tag;
        renderTagFilterBar();
        updateHistoryUI();
      });
      els.tagFilterBar.appendChild(chip);
    });
  }

  function renderTagsManageList() {
    els.tagsManageList.innerHTML = "";
    if (currentTags.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.style.padding = "10px";
      empty.textContent = "Chưa có nhãn nào.";
      els.tagsManageList.appendChild(empty);
      return;
    }

    currentTags.forEach(tag => {
      const count = currentHistory.filter(h => h.tag === tag).length;
      const item = document.createElement("div");
      item.className = "tag-manage-item";

      const info = document.createElement("div");
      info.innerHTML = `<span class="tag-manage-name">${escapeHtml(tag)}</span><span class="tag-manage-count">(${count})</span>`;

      const actions = document.createElement("div");
      actions.className = "tag-manage-actions";

      const editBtn = document.createElement("button");
      editBtn.className = "tag-manage-edit";
      editBtn.title = "Đổi tên nhãn";
      editBtn.type = "button";
      editBtn.innerHTML = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>`;
      editBtn.addEventListener("click", () => {
        const input = document.createElement("input");
        input.type = "text";
        input.className = "inline-tag-edit-input";
        input.value = tag;
        input.maxLength = 20;

        let finished = false;
        function finishTagEdit(save) {
          if (finished) return;
          finished = true;
          if (save) {
            const newTag = input.value.trim();
            if (newTag && newTag !== tag) {
              if (currentTags.includes(newTag)) {
                showToast("Tên nhãn đã tồn tại!");
              } else {
                const idx = currentTags.indexOf(tag);
                if (idx !== -1) currentTags[idx] = newTag;

                let historyChanged = false;
                currentHistory.forEach(h => {
                  if (h.tag === tag) {
                    h.tag = newTag;
                    historyChanged = true;
                  }
                });

                if (activeFilterTag === tag) {
                  activeFilterTag = newTag;
                }

                saveTags();
                if (historyChanged && chrome?.storage?.local) {
                  persistKey("genHistory", currentHistory);
                }
                renderTags();
                updateHistoryUI();
                showToast(`Đã đổi tên nhãn thành "${newTag}"!`);
                return;
              }
            }
          }
          renderTagsManageList();
        }

        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") finishTagEdit(true);
          else if (e.key === "Escape") finishTagEdit(false);
        });
        input.addEventListener("blur", () => finishTagEdit(true));

        item.innerHTML = "";
        item.appendChild(input);
        input.focus();
        input.select();
      });

      const delBtn = document.createElement("button");
      delBtn.className = "tag-manage-del";
      delBtn.title = "Xóa nhãn";
      delBtn.type = "button";
      delBtn.innerHTML = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
      delBtn.addEventListener("click", () => {
        currentTags = currentTags.filter(t => t !== tag);
        let historyModified = false;
        currentHistory.forEach(h => {
          if (h.tag === tag) {
            h.tag = "";
            historyModified = true;
          }
        });
        if (activeFilterTag === tag) {
          activeFilterTag = "";
        }
        saveTags();
        if (historyModified && chrome?.storage?.local) {
          persistKey("genHistory", currentHistory);
        }
        renderTags();
        updateHistoryUI();
        showToast(`Đã xóa nhãn "${tag}"!`);
      });

      actions.appendChild(editBtn);
      actions.appendChild(delBtn);

      item.appendChild(info);
      item.appendChild(actions);
      els.tagsManageList.appendChild(item);
    });
  }

  function getActivePoolSize(opts) {
    let size = 0;
    if (opts.upper) size += CHAR_SETS.upper.length;
    if (opts.lower) size += CHAR_SETS.lower.length;
    if (opts.numbers) size += CHAR_SETS.numbers.length;
    if (opts.special) size += CHAR_SETS.special.length;
    return Math.max(size, 1);
  }

  function getOptions() {
    return {
      generatorMode: currentGenMode,
      length: parseInt(els.lengthRange.value, 10),
      upper: els.optUpper.checked,
      lower: els.optLower.checked,
      numbers: els.optNumbers.checked,
      special: els.optSpecial.checked,
      avoidAmbiguous: els.optAvoidAmbiguous.checked,
      autoSavePrompt: els.optAutoSavePrompt.checked,
      autoFillBadge: els.optAutoFill.checked,
      minNumbers: parseInt(els.minNumbers.value, 10) || 0,
      minSpecial: parseInt(els.minSpecial.value, 10) || 0,
      passphraseWords: parseInt(els.passphraseWordsRange?.value, 10) || 4,
      passphraseSeparator: els.passphraseSeparator?.value || "-",
      passphraseCapitalize: els.optPassphraseCapitalize?.checked !== false,
      passphraseNumber: !!els.optPassphraseNumber?.checked,
      autoClearClipboard: els.optAutoClearClipboard ? !!els.optAutoClearClipboard.checked : true,
      maskPassword: els.display ? els.display.type === "password" : true,
      vaultEnabled: els.optVaultEnabled ? els.optVaultEnabled.checked : false,
      vaultLockClose: els.optVaultLockClose ? els.optVaultLockClose.checked : false,
      vaultTimeoutMin: els.optVaultTimeout ? Number(els.optVaultTimeout.value) : 15
    };
  }

  function saveOptions(opts) {
    if (chrome?.storage?.local) {
      chrome.storage.local.set({ genOptions: opts });
    }
  }

  // --- Kho ma hoa (Argon2id + AES-256-GCM) ---
  function vaultReady() {
    return typeof GPVault !== "undefined" && !!GPVault.encryptWithPin && !!GPVault.reencrypt;
  }

  // Phut khong dung truoc khi tu khoa; 0 = giu phien den khi tat trinh duyet
  function vaultTimeoutMin() {
    if (!els.optVaultTimeout) return 15;
    const min = parseInt(els.optVaultTimeout.value, 10);
    return Number.isNaN(min) ? 15 : min;
  }

  // Phien luu duoi dang envelope { k: keyB64, exp: epoch ms | null }
  function vaultSessionSet(keyB64, timeoutMin) {
    return chrome.storage.session.set({
      genVaultKey: { k: keyB64, exp: timeoutMin > 0 ? Date.now() + timeoutMin * 60000 : null }
    });
  }

  // Doc envelope; van ho tiep key dang chuoi tran cua ban cu
  function vaultSessionKey(sess) {
    const raw = sess?.genVaultKey;
    if (typeof raw === "string") return { k: raw, exp: null };
    if (raw && typeof raw === "object" && raw.k) return { k: raw.k, exp: raw.exp || null };
    return null;
  }

  function vaultSyncSettings() {
    if (els.optVaultEnabled) els.optVaultEnabled.checked = vaultOpts.vaultEnabled;
    if (els.optVaultLockClose) els.optVaultLockClose.checked = vaultOpts.vaultLockClose;
    if (els.optVaultTimeout) els.optVaultTimeout.value = String(vaultOpts.vaultTimeoutMin);
    if (els.vaultExtraSettings) els.vaultExtraSettings.hidden = !vaultOn;
    if (els.vaultStatus) {
      els.vaultStatus.textContent = vaultOn
        ? "Argon2id 64MB · tự khóa sau " + (vaultOpts.vaultTimeoutMin > 0 ? vaultOpts.vaultTimeoutMin + " phút" : "khi tắt trình duyệt")
        : "Kho chưa mã hóa";
    }
  }

  // Dua du lieu giai mai vao cac bien dang dung cho UI
  function vaultFill(data, keyB64) {
    currentHistory = Array.isArray(data.genHistory) ? data.genHistory : [];
    current2FA = Array.isArray(data.gen2FA) ? data.gen2FA : [];
    currentCards = Array.isArray(data.genCards) ? data.genCards : [];
    currentCookieProfiles = Array.isArray(data.genCookieProfiles) ? data.genCookieProfiles : [];
    currentTags = (Array.isArray(data.genTags) && data.genTags.length > 0) ? data.genTags : [...DEFAULT_TAGS];
    vaultKey = keyB64;
    vaultData = {
      genHistory: currentHistory,
      gen2FA: current2FA,
      genCards: currentCards,
      genCookieProfiles: currentCookieProfiles,
      genTags: currentTags
    };
  }

  // Port toi service worker: dong popup -> SW xoa key phien neu bat tuy chon
  function vaultPortConnect() {
    if (vaultPort || !chrome?.runtime?.connect) return; // mot popup chi can mot port
    try {
      vaultPort = chrome.runtime.connect({ name: "vault-session" });
      vaultPort.onDisconnect.addListener(() => {
        vaultPort = null;
        // SW bi kill giua chung: ket noi lai sau 500ms neu popup van mo va kho van mo
        if (vaultOn) setTimeout(() => { if (vaultOn) vaultPortConnect(); }, 500);
      });
    } catch (err) {
      vaultPort = null;
    }
  }

  // Gia han han tu khoa moi 20s khi con dung, SW van tu kiem tra exp moi lan doc
  function vaultHeartbeatStart() {
    if (vaultHeartbeat) clearInterval(vaultHeartbeat);
    const min = vaultTimeoutMin();
    if (min <= 0) return;
    vaultHeartbeat = setInterval(() => {
      if (vaultKey) vaultSessionSet(vaultKey, min).catch(() => {});
    }, 20000);
  }

  function vaultSessionStop() {
    if (vaultHeartbeat) {
      clearInterval(vaultHeartbeat);
      vaultHeartbeat = null;
    }
    if (vaultPort) {
      try {
        vaultPort.disconnect();
      } catch (err) {
        // port da dong san
      }
      vaultPort = null;
    }
  }

  function vaultView() {
    renderTags();
    updateHistoryUI();
    render2FA();
    renderCards();
    renderCookieProfiles();
    start2FaTicker();
  }

  function vaultShowError(el, msg) {
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
  }

  function vaultShowLock(cb) {
    vaultDeferredCb = cb || null;
    vaultOn = false;
    vaultKey = null;
    vaultData = {};
    vaultHideError(els.vaultLockError);
    if (els.vaultLock) els.vaultLock.hidden = false;
    if (els.vaultPin) {
      els.vaultPin.value = "";
      els.vaultPin.focus();
    }
  }

  function vaultHideError(el) {
    if (el) el.hidden = true;
  }

  // Doi nhan nut trong luc Argon2id chay de nguoi dung khong bam lap
  // nhan cuoi cung la chuoi khoi phuc, tranh phu thuoc vao dataset cua DOM gia
  function vaultBusy(btn, busy, label) {
    if (!btn) return;
    if (label) btn.textContent = label;
    btn.disabled = !!busy;
  }

  function vaultRunAfterUnlock() {
    if (els.vaultLock) els.vaultLock.hidden = true;
    const cb = vaultDeferredCb;
    vaultDeferredCb = null;
    vaultView();
    if (cb) cb();
  }

  async function vaultUnlock() {
    if (!vaultBlob || !vaultReady()) return;
    const pin = (els.vaultPin?.value || "").trim();
    if (!pin) {
      vaultShowError(els.vaultLockError, "Nhập mã PIN");
      return;
    }
    vaultBusy(els.vaultUnlockBtn, true, "Đang mở khóa…");
    try {
      const { data, keyB64 } = await GPVault.unlockWithPin(vaultBlob, pin);
      vaultFill(data, keyB64); // keyB64 la chuoi base64 cua key tho
      await vaultSessionSet(keyB64, vaultTimeoutMin());
      vaultOn = true;
      vaultPortConnect();
      vaultHeartbeatStart();
      vaultSyncSettings();
      vaultRunAfterUnlock();
    } catch (err) {
      console.warn("Mo kho that bai:", err);
      vaultShowError(els.vaultLockError, "Mã PIN không đúng");
      if (els.vaultPin) {
        els.vaultPin.value = "";
        els.vaultPin.focus();
      }
    } finally {
      vaultBusy(els.vaultUnlockBtn, false, "Mở khóa");
    }
  }

  // Ghi rac len chuoi plaintext cu truoc khi xoa, han che phuc hoi tu LevelDB
  async function vaultShredPlaintext() {
    const keys = ["genHistory", "gen2FA", "genCards", "genCookieProfiles", "genTags"];
    const cur = await chrome.storage.local.get(keys);
    const junk = {};
    keys.forEach(k => {
      const len = JSON.stringify(cur[k] ?? []).length;
      if (len > 2) junk[k] = "x".repeat(len);
    });
    if (Object.keys(junk).length) await chrome.storage.local.set(junk);
    await chrome.storage.local.remove(keys);
  }

  async function vaultEnable(secret) {
    const payload = {
      genHistory: currentHistory,
      gen2FA: current2FA,
      genCards: currentCards,
      genCookieProfiles: currentCookieProfiles,
      genTags: currentTags
    };
    const blob = await GPVault.encryptWithPin(payload, secret);
    // Mot lan KDF them de lay key luu phien, tranh phai nhap lai ma
    const keyB64 = (await GPVault.unlockWithPin(blob, secret)).keyB64;
    await chrome.storage.local.set({ genVault: blob });
    await vaultShredPlaintext();
    await vaultSessionSet(keyB64, vaultTimeoutMin());
    vaultFill(payload, keyB64); // giu key trong bo nho de cac lan luu sau ma hoa duoc
    vaultBlob = blob;
    vaultOn = true;
    vaultOpts.vaultEnabled = true;
    vaultSyncSettings();
    saveOptions(getOptions());
    vaultPortConnect();
    vaultHeartbeatStart();
    vaultView();
    showToast("Đã bật mã hóa kho");
  }

  async function vaultDisable(pin) {
    const { data } = await GPVault.unlockWithPin(vaultBlob, pin);
    await chrome.storage.local.set({
      genHistory: data.genHistory || [],
      gen2FA: data.gen2FA || [],
      genCards: data.genCards || [],
      genCookieProfiles: data.genCookieProfiles || [],
      genTags: data.genTags || []
    });
    await chrome.storage.local.remove("genVault");
    await chrome.storage.session.remove("genVaultKey");
    vaultSessionStop();
    vaultOn = false;
    vaultBlob = null;
    vaultKey = null;
    vaultData = {};
    vaultOpts.vaultEnabled = false;
    if (els.optVaultEnabled) els.optVaultEnabled.checked = false;
    saveOptions(getOptions());
    vaultSyncSettings();
    showToast("Đã tắt mã hóa kho");
  }

  async function vaultChangePin(secret) {
    const blob = await GPVault.encryptWithPin(vaultData, secret);
    const keyB64 = (await GPVault.unlockWithPin(blob, secret)).keyB64;
    await chrome.storage.local.set({ genVault: blob });
    await vaultSessionSet(keyB64, vaultTimeoutMin()); // lam moi han tu khoa
    vaultKey = keyB64; // key cu khong ma hoa duoc blob moi
    vaultBlob = blob;
    showToast("Đã đổi mã PIN");
  }

  function vaultOpenPinModal(title) {
    if (els.modalVaultPinTitle) els.modalVaultPinTitle.textContent = title;
    if (els.vaultPinNew) els.vaultPinNew.value = "";
    if (els.vaultPinConfirm) els.vaultPinConfirm.value = "";
    vaultHideError(els.vaultPinError);
    vaultUpdatePinStrength();
    if (els.modalVaultPin) els.modalVaultPin.hidden = false;
    if (els.vaultPinNew) els.vaultPinNew.focus();
  }

  function vaultOpenDisableModal() {
    if (els.vaultPinOff) els.vaultPinOff.value = "";
    vaultHideError(els.vaultOffError);
    if (els.modalVaultDisable) els.modalVaultDisable.hidden = false;
    if (els.vaultPinOff) els.vaultPinOff.focus();
  }

  // Chu+so thi it nhat 8 ky tu, chi so thi it nhat 10 so
  function vaultSecretOk(s) {
    return s.length >= 8 && (/\D/.test(s) ? true : s.length >= 10);
  }

  function vaultSecretLabel(s) {
    if (s.length < 8) return "Yếu";
    if (!/\D/.test(s)) return s.length < 10 ? "Yếu" : "Trung bình"; // chi so: <10 yeu, tu 10 so tro len trung binh
    if (s.length >= 12) return "Mạnh";
    return "Trung bình";
  }

  function vaultUpdatePinStrength() {
    if (!els.vaultPinStrength) return;
    const s = (els.vaultPinNew?.value || "").trim();
    const weakDigits = !/\D/.test(s) && s.length < 10;
    if (!s) {
      els.vaultPinStrength.hidden = true;
      els.vaultPinStrength.textContent = "";
      els.vaultPinStrength.classList.remove("vault-modal-error");
      return;
    }
    els.vaultPinStrength.hidden = false;
    els.vaultPinStrength.textContent = "Độ mạnh mã bảo vệ: " + vaultSecretLabel(s);
    els.vaultPinStrength.classList.toggle("vault-modal-error", weakDigits);
  }

  async function vaultSavePin() {
    const secret = (els.vaultPinNew?.value || "").trim();
    const confirm = (els.vaultPinConfirm?.value || "").trim();
    if (!vaultSecretOk(secret)) {
      vaultShowError(els.vaultPinError, "Tối thiểu 8 ký tự (chỉ số thì 10 số)");
      return;
    }
    if (secret !== confirm) {
      vaultShowError(els.vaultPinError, "Mã PIN nhập lại không khớp");
      return;
    }
    if (!vaultReady()) {
      vaultShowError(els.vaultPinError, "Không tải được bộ mã hóa");
      return;
    }
    if (!/\D/.test(secret)) {
      vaultShowError(els.vaultPinError, "Nên dùng cả chữ và số để khó đoán hơn, đừng chỉ dùng số.");
    } else {
      vaultHideError(els.vaultPinError);
    }
    vaultBusy(els.btnVaultPinSave, true, "Đang lưu…");
    try {
      if (vaultPinMode === "change") await vaultChangePin(secret);
      else await vaultEnable(secret);
      if (els.modalVaultPin) els.modalVaultPin.hidden = true;
    } catch (err) {
      console.error("Lưu PIN thất bại:", err);
      vaultShowError(els.vaultPinError, "Không lưu được mã PIN");
    } finally {
      vaultBusy(els.btnVaultPinSave, false, "Lưu mã PIN");
    }
  }

  async function vaultDisableConfirm() {
    const pin = (els.vaultPinOff?.value || "").trim();
    if (!pin) {
      vaultShowError(els.vaultOffError, "Nhập mã PIN");
      return;
    }
    vaultBusy(els.btnVaultOffConfirm, true, "Đang xử lý…");
    try {
      await vaultDisable(pin);
      if (els.modalVaultDisable) els.modalVaultDisable.hidden = true;
    } catch (err) {
      console.warn("Tắt kho thất bại:", err);
      vaultShowError(els.vaultOffError, "Mã PIN không đúng");
    } finally {
      vaultBusy(els.btnVaultOffConfirm, false, "Giải mã & tắt");
    }
  }

  // Ghi 1 khoa nhay cam: kho dang bat thi ma hoa lai ca blob, nguoc lai ghi thang nhu cu
  async function persist(key, value) {
    if (!vaultOn || !vaultKey || !vaultBlob) {
      chrome.storage.local.set({ [key]: value });
      return;
    }
    vaultData[key] = value;
    const blob = await GPVault.reencrypt(vaultData, vaultKey, {
      salt: vaultBlob.salt,
      t: vaultBlob.t,
      m: vaultBlob.m,
      p: vaultBlob.p
    });
    vaultBlob = blob;
    await chrome.storage.local.set({ genVault: blob });
  }

  // Bao loi thanh toast de khong im lang mat du lieu
  function persistKey(key, value) {
    persist(key, value).catch(err => {
      console.error("Lưu " + key + " thất bại:", err);
      showToast("Lỗi khi lưu dữ liệu vào kho mã hóa!");
    });
  }

  function loadOptions(cb) {
    if (chrome?.storage?.local) {
      chrome.storage.local.get(["genOptions", "genHistory", "genTags", "gen2FA", "genCards", "genCookieProfiles", "genVault"], (res) => {
        if (res.genOptions) {
          const o = res.genOptions;
          vaultOpts.vaultEnabled = o.vaultEnabled === true;
          vaultOpts.vaultLockClose = o.vaultLockClose !== false; // mac dinh: tu khoa khi dong popup
          vaultOpts.vaultTimeoutMin = Number(o.vaultTimeoutMin ?? 15);
          if (els.optVaultTimeout) els.optVaultTimeout.value = String(o.vaultTimeoutMin ?? 15);
          els.lengthRange.value = o.length || 16;
          els.lengthVal.textContent = o.length || 16;
          els.optUpper.checked = o.upper !== false;
          els.optLower.checked = o.lower !== false;
          els.optNumbers.checked = o.numbers !== false;
          els.optSpecial.checked = o.special !== false;
          els.optAvoidAmbiguous.checked = !!o.avoidAmbiguous;
          els.optAutoSavePrompt.checked = o.autoSavePrompt !== false;
          els.optAutoFill.checked = o.autoFillBadge !== false;
          if (els.optAutoClearClipboard) {
            els.optAutoClearClipboard.checked = o.autoClearClipboard !== false;
          }
          els.minNumbers.value = o.minNumbers ?? 1;
          els.minSpecial.value = o.minSpecial ?? 1;

          // Che mat khau o o output: mac dinh bat
          maskHistoryPass = o.maskPassword !== false;
          isMasked = maskHistoryPass;
          if (els.display) els.display.type = maskHistoryPass ? "password" : "text";
          if (els.toggleMask) els.toggleMask.title = isMasked ? "Hiện mật khẩu" : "Ẩn mật khẩu";

          if (o.generatorMode === "passphrase") {
            currentGenMode = "passphrase";
            els.btnModePassword.classList.remove("active");
            els.btnModePassphrase.classList.add("active");
            els.panelModePassword.hidden = true;
            els.panelModePassphrase.hidden = false;
          }
          if (o.passphraseWords) {
            els.passphraseWordsRange.value = o.passphraseWords;
            els.passphraseWordsVal.textContent = o.passphraseWords;
          }
          if (o.passphraseSeparator) {
            els.passphraseSeparator.value = o.passphraseSeparator;
          }
          if (o.passphraseCapitalize !== undefined) {
            els.optPassphraseCapitalize.checked = o.passphraseCapitalize;
          }
          if (o.passphraseNumber !== undefined) {
            els.optPassphraseNumber.checked = o.passphraseNumber;
          }
        }

        // Kho ma hoa dang bat: chi doc blob, khoa nhay cam phai giai mai bang ma bao ve
        if (vaultOpts.vaultEnabled && res.genVault && vaultReady()) {
          vaultBlob = res.genVault;
          vaultOn = false;
          vaultKey = null;
          vaultData = {};
          vaultSyncSettings();
          chrome.storage.session.get("genVaultKey", (sess) => {
            const entry = vaultSessionKey(sess);
            const expired = entry && entry.exp && Date.now() > entry.exp;
            if (!entry || !entry.k || expired) {
              if (expired) chrome.storage.session.remove("genVaultKey"); // phien qua han tu dong
              vaultShowLock(cb);
              return;
            }
            GPVault.decryptBlob(res.genVault, entry.k)
              .then(data => {
                vaultFill(data, entry.k);
                vaultOn = true;
                vaultSessionSet(entry.k, vaultTimeoutMin()).catch(() => {});
                vaultPortConnect();
                vaultHeartbeatStart();
                vaultSyncSettings();
                vaultRunAfterUnlock();
              })
              .catch(err => {
                console.warn("Phien kho het han:", err);
                chrome.storage.session.remove("genVaultKey"); // key cu, khong giai mai duoc blob
                vaultShowLock(cb);
              });
          });
          return;
        }

        if (Array.isArray(res.genTags) && res.genTags.length > 0) {
          currentTags = res.genTags;
        } else {
          currentTags = [...DEFAULT_TAGS];
        }
        if (Array.isArray(res.genHistory)) {
          currentHistory = res.genHistory;
        }
        if (Array.isArray(res.gen2FA)) {
          current2FA = res.gen2FA;
        }
        if (Array.isArray(res.genCards)) {
          currentCards = res.genCards;
        }
        if (Array.isArray(res.genCookieProfiles)) {
          currentCookieProfiles = res.genCookieProfiles;
        }
        vaultSyncSettings();
        renderTags();
        updateHistoryUI();
        render2FA();
        renderCards();
        renderCookieProfiles();
        start2FaTicker();
        cb();
      });
    } else {
      renderTags();
      updateHistoryUI();
      render2FA();
      renderCards();
      renderCookieProfiles();
      start2FaTicker();
      cb();
    }
  }

  function saveHistoryItem(password, name = "", tag = "", url = "", note = "", username = "") {
    if (!password) return;
    const trimmedName = (name || "").trim();
    const cleanTag = (tag || "").trim();
    const cleanUrl = (url || currentTabUrl || "").trim();
    const cleanNote = (note !== undefined ? note : (els.passwordNote?.value || "")).trim();
    const cleanUser = (username !== undefined ? username : (els.passwordUser?.value || "")).trim();

    if (currentHistory.length > 0 && currentHistory[0].password === password) {
      let modified = false;
      if (trimmedName && currentHistory[0].name !== trimmedName) {
        currentHistory[0].name = trimmedName;
        modified = true;
      }
      if (cleanUser && currentHistory[0].username !== cleanUser) {
        currentHistory[0].username = cleanUser;
        modified = true;
      }
      if (cleanTag && currentHistory[0].tag !== cleanTag) {
        currentHistory[0].tag = cleanTag;
        modified = true;
      }
      if (cleanUrl && currentHistory[0].url !== cleanUrl) {
        currentHistory[0].url = cleanUrl;
        modified = true;
      }
      if (cleanNote && currentHistory[0].note !== cleanNote) {
        currentHistory[0].note = cleanNote;
        modified = true;
      }
      if (modified) {
        updateHistoryUI();
        renderTagFilterBar();
        if (chrome?.storage?.local) {
          persistKey("genHistory", currentHistory);
        }
      }
      return; // Skip duplicate consecutive saves
    }

    const item = {
      id: Date.now().toString(),
      name: trimmedName,
      username: cleanUser,
      tag: cleanTag,
      url: cleanUrl,
      note: cleanNote,
      password,
      length: password.length,
      createdAt: new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) + " " + new Date().toLocaleDateString("vi-VN")
    };

    currentHistory.unshift(item);
    if (currentHistory.length > 200) currentHistory.pop(); // Max 200 items

    updateHistoryUI();
    renderTagFilterBar();
    if (chrome?.storage?.local) {
      persistKey("genHistory", currentHistory);
    }
  }

  function updateHistoryUI() {
    els.historyCount.textContent = currentHistory.length;
    els.historyList.innerHTML = "";

    let filtered = activeFilterTag
      ? currentHistory.filter(h => h.tag === activeFilterTag)
      : currentHistory;

    if (currentSearchQuery) {
      filtered = filtered.filter(item => {
        const name = (item.name || "").toLowerCase();
        const user = (item.username || "").toLowerCase();
        const url = (item.url || "").toLowerCase();
        const tag = (item.tag || "").toLowerCase();
        const note = (item.note || "").toLowerCase();
        return name.includes(currentSearchQuery) || user.includes(currentSearchQuery) || url.includes(currentSearchQuery) || tag.includes(currentSearchQuery) || note.includes(currentSearchQuery);
      });
    }

    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      if (currentSearchQuery) {
        empty.textContent = `Không tìm thấy mật khẩu nào khớp với "${currentSearchQuery}".`;
      } else if (activeFilterTag) {
        empty.textContent = `Chưa có mật khẩu nào thuộc nhãn "${activeFilterTag}".`;
      } else {
        empty.textContent = "Chưa có mật khẩu nào được lưu.";
      }
      els.historyList.appendChild(empty);
      return;
    }

    filtered.forEach((item) => {
      const row = document.createElement("div");
      row.className = "history-item";

      const details = document.createElement("div");
      details.className = "history-details";

      const nameRow = document.createElement("div");
      nameRow.className = "history-name-row";

      const nameEl = document.createElement("span");
      nameEl.className = item.name ? "history-name" : "history-name empty";
      nameEl.textContent = item.name || "Chưa đặt tên";
      nameEl.title = "Bấm để đổi tên/nhãn";

      nameRow.appendChild(nameEl);

      if (item.tag) {
        const tagEl = document.createElement("span");
        tagEl.className = "tag-badge";
        tagEl.textContent = item.tag;
        nameRow.appendChild(tagEl);
      }

      const editBtn = document.createElement("button");
      editBtn.className = "btn-edit-name";
      editBtn.title = "Đổi tên, nhãn hoặc ghi chú";
      editBtn.type = "button";
      editBtn.innerHTML = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>`;

      function startEdit() {
        const input = document.createElement("input");
        input.type = "text";
        input.className = "inline-name-input";
        input.value = item.name || "";
        input.maxLength = 50;
        input.placeholder = "Nhập tên...";

        const tagSelect = document.createElement("select");
        tagSelect.className = "tag-select";
        tagSelect.style.width = "90px";
        tagSelect.style.padding = "2px 4px";
        tagSelect.style.fontSize = "11px";
        tagSelect.innerHTML = `<option value="">(Không nhãn)</option>` +
          currentTags.map(t => `<option value="${escapeHtml(t)}" ${t === item.tag ? "selected" : ""}>${escapeHtml(t)}</option>`).join("");

        const userInput = document.createElement("input");
        userInput.type = "text";
        userInput.className = "history-user-input";
        userInput.value = item.username || "";
        userInput.maxLength = 50;
        userInput.placeholder = "Tài khoản / Email...";

        const noteInput = document.createElement("input");
        noteInput.type = "text";
        noteInput.className = "history-note-input";
        noteInput.value = item.note || "";
        noteInput.maxLength = 200;
        noteInput.placeholder = "Ghi chú bảo mật (mã backup 2FA, PIN...)...";

        let finished = false;
        function finishEdit(save) {
          if (finished) return;
          finished = true;
          if (save) {
            const newName = input.value.trim();
            const newUser = userInput.value.trim();
            const newTag = tagSelect.value;
            const newNote = noteInput.value.trim();
            let changed = false;
            if (newName !== (item.name || "")) {
              item.name = newName;
              changed = true;
            }
            if (newUser !== (item.username || "")) {
              item.username = newUser;
              changed = true;
            }
            if (newTag !== (item.tag || "")) {
              item.tag = newTag;
              changed = true;
            }
            if (newNote !== (item.note || "")) {
              item.note = newNote;
              changed = true;
            }
            if (changed) {
              if (chrome?.storage?.local) {
                persistKey("genHistory", currentHistory);
              }
              renderTagFilterBar();
              showToast("Đã cập nhật!");
            }
          }
          updateHistoryUI();
        }

        [input, userInput, noteInput].forEach(inp => {
          inp.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
              finishEdit(true);
            } else if (e.key === "Escape") {
              finishEdit(false);
            }
          });
        });

        tagSelect.addEventListener("change", () => finishEdit(true));

        const handleBlur = () => {
          setTimeout(() => {
            if (document.activeElement !== tagSelect && document.activeElement !== input && document.activeElement !== userInput && document.activeElement !== noteInput) {
              finishEdit(true);
            }
          }, 150);
        };
        input.addEventListener("blur", handleBlur);
        userInput.addEventListener("blur", handleBlur);
        noteInput.addEventListener("blur", handleBlur);

        nameRow.innerHTML = "";
        nameRow.appendChild(input);
        nameRow.appendChild(userInput);
        nameRow.appendChild(tagSelect);
        nameRow.appendChild(noteInput);
        input.focus();
        input.select();
      }

      nameEl.addEventListener("click", startEdit);
      editBtn.addEventListener("click", startEdit);
      nameRow.appendChild(editBtn);

      details.appendChild(nameRow);

      if (item.username) {
        const userRow = document.createElement("div");
        userRow.className = "history-user-row";
        userRow.innerHTML = `<span class="history-user-icon">👤</span><span class="history-user-text">${escapeHtml(item.username)}</span>`;
        userRow.title = "Bấm để sao chép tên đăng nhập";
        userRow.addEventListener("click", () => {
          navigator.clipboard.writeText(item.username);
          scheduleClipboardClear(item.username);
          showToast("Đã sao chép tên đăng nhập!");
        });
        details.appendChild(userRow);
      }

      const passEl = document.createElement("span");
      passEl.className = "history-pass";
      // Mat khau an thanh cham, bam mat de hien lai tung dong
      passEl.textContent = (maskHistoryPass && !unmaskedHistoryIds.has(item.id))
        ? "•".repeat(Math.min((item.password || "").length, 12))
        : item.password;
      passEl.title = "Bấm để sao chép";
      passEl.addEventListener("click", () => {
        navigator.clipboard.writeText(item.password);
        scheduleClipboardClear(item.password);
        showToast("Đã sao chép mật khẩu!");
      });

      const timeEl = document.createElement("span");
      timeEl.className = "history-time";
      const domain = extractDomain(item.url);
      timeEl.textContent = `${item.createdAt} (${item.length} ký tự)${domain ? " • " + domain : ""}`;
      if (item.url) timeEl.title = item.url;

      details.appendChild(passEl);
      details.appendChild(timeEl);

      if (item.note) {
        const noteEl = document.createElement("div");
        noteEl.className = "history-note";
        noteEl.textContent = `📝 ${item.note}`;
        noteEl.title = "Bấm để sao chép ghi chú";
        noteEl.addEventListener("click", () => {
          navigator.clipboard.writeText(item.note);
          scheduleClipboardClear(item.note);
          showToast("Đã sao chép ghi chú!");
        });
        details.appendChild(noteEl);
      }

      const actions = document.createElement("div");
      actions.className = "history-actions";

      const copyBtn = document.createElement("button");
      copyBtn.className = "icon-btn";
      copyBtn.title = "Sao chép";
      copyBtn.type = "button";
      copyBtn.innerHTML = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
      copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(item.password);
        scheduleClipboardClear(item.password);
        showToast("Đã sao chép mật khẩu!");
      });

      const delBtn = document.createElement("button");
      delBtn.className = "icon-btn";
      delBtn.title = "Xóa";
      delBtn.type = "button";
      delBtn.innerHTML = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
      delBtn.addEventListener("click", () => {
        currentHistory = currentHistory.filter(h => h.id !== item.id);
        updateHistoryUI();
        renderTagFilterBar();
        if (chrome?.storage?.local) {
          persistKey("genHistory", currentHistory);
        }
      });

      const eyeBtn = document.createElement("button");
      eyeBtn.className = "icon-btn";
      eyeBtn.title = unmaskedHistoryIds.has(item.id) ? "Ẩn mật khẩu" : "Hiện mật khẩu";
      eyeBtn.type = "button";
      eyeBtn.innerHTML = unmaskedHistoryIds.has(item.id) ? EYE_OFF_SVG : EYE_ON_SVG;
      eyeBtn.addEventListener("click", () => {
        if (unmaskedHistoryIds.has(item.id)) unmaskedHistoryIds.delete(item.id);
        else unmaskedHistoryIds.add(item.id);
        updateHistoryUI();
      });

      actions.appendChild(copyBtn);
      actions.appendChild(eyeBtn);
      actions.appendChild(delBtn);

      row.appendChild(details);
      row.appendChild(actions);
      els.historyList.appendChild(row);
    });
  }

  async function render2FA() {
    els.count2Fa.textContent = current2FA.length;
    els.list2Fa.innerHTML = "";

    if (current2FA.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = 'Chưa có mã 2FA nào. Bấm "+ Thêm mã" để bắt đầu.';
      els.list2Fa.appendChild(empty);
      return;
    }

    const currentDomain = extractDomain(currentTabUrl).toLowerCase();

    // Prioritize 2FA items matching current domain
    const sorted = [...current2FA].sort((a, b) => {
      const matchA = currentDomain && (a.name.toLowerCase().includes(currentDomain) || currentDomain.includes(a.name.toLowerCase()));
      const matchB = currentDomain && (b.name.toLowerCase().includes(currentDomain) || currentDomain.includes(b.name.toLowerCase()));
      if (matchA && !matchB) return -1;
      if (!matchA && matchB) return 1;
      return 0;
    });

    const nowSec = Math.floor(Date.now() / 1000);
    const remainingSec = 30 - (nowSec % 30);
    const pct = (remainingSec / 30) * 100;

    for (const item of sorted) {
      const card = document.createElement("div");
      card.className = "twofa-item";

      const header = document.createElement("div");
      header.className = "twofa-item-header";

      const nameGroup = document.createElement("div");
      nameGroup.className = "twofa-name-group";

      const nameEl = document.createElement("span");
      nameEl.className = "twofa-name";
      nameEl.textContent = item.name;
      nameGroup.appendChild(nameEl);

      if (item.account) {
        const accEl = document.createElement("span");
        accEl.className = "twofa-account";
        accEl.textContent = `(${item.account})`;
        nameGroup.appendChild(accEl);
      }

      const isMatch = currentDomain && (item.name.toLowerCase().includes(currentDomain) || currentDomain.includes(item.name.toLowerCase()));
      if (isMatch) {
        const badge = document.createElement("span");
        badge.className = "twofa-match-badge";
        badge.textContent = "Trang hiện tại";
        nameGroup.appendChild(badge);
      }

      header.appendChild(nameGroup);

      const code = await generateTotp(item.secret, nowSec);
      const formattedCode = code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;

      const codeRow = document.createElement("div");
      codeRow.className = "twofa-code-row";

      const codeEl = document.createElement("span");
      codeEl.className = "twofa-code";
      codeEl.textContent = formattedCode;
      codeEl.title = "Bấm để sao chép";
      codeEl.addEventListener("click", () => {
        navigator.clipboard.writeText(code);
        scheduleClipboardClear(code);
        showToast("Đã sao chép mã 2FA!");
      });

      codeRow.appendChild(codeEl);

      const pBar = document.createElement("div");
      pBar.className = "twofa-progress-bar";

      const pFill = document.createElement("div");
      pFill.className = "twofa-progress-fill" + (remainingSec <= 5 ? " danger" : remainingSec <= 10 ? " warning" : "");
      pFill.style.width = `${pct}%`;
      pBar.appendChild(pFill);

      const actions = document.createElement("div");
      actions.className = "twofa-actions";

      const fillBtn = document.createElement("button");
      fillBtn.type = "button";
      fillBtn.className = "twofa-btn-action twofa-btn-fill";
      fillBtn.innerHTML = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg> <span>Điền vào web</span>`;
      fillBtn.addEventListener("click", () => {
        fill2FaToActiveTab(code);
      });

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "twofa-btn-action";
      copyBtn.innerHTML = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg> <span>Sao chép</span>`;
      copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(code);
        scheduleClipboardClear(code);
        showToast("Đã sao chép mã 2FA!");
      });

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "icon-btn";
      delBtn.title = "Xóa";
      delBtn.innerHTML = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
      delBtn.addEventListener("click", () => {
        current2FA = current2FA.filter(i => i.id !== item.id);
        if (chrome?.storage?.local) {
          persistKey("gen2FA", current2FA);
        }
        render2FA();
        showToast(`Đã xóa mã 2FA "${item.name}"!`);
      });

      actions.appendChild(fillBtn);
      actions.appendChild(copyBtn);
      actions.appendChild(delBtn);

      card.appendChild(header);
      card.appendChild(codeRow);
      card.appendChild(pBar);
      card.appendChild(actions);

      els.list2Fa.appendChild(card);
    }
  }

  function start2FaTicker() {
    if (tickerInterval) clearInterval(tickerInterval);
    tickerInterval = setInterval(() => {
      if (els.view2Fa.classList.contains("active")) {
        render2FA();
      }
    }, 1000);
  }

  function escapeCsvCell(cell) {
    if (cell === null || cell === undefined) return "";
    const str = String(cell);
    if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  function exportToCsv() {
    const itemsToExport = activeFilterTag
      ? currentHistory.filter(h => h.tag === activeFilterTag)
      : currentHistory;

    if (itemsToExport.length === 0) {
      showToast("Không có mật khẩu nào để xuất!");
      return;
    }

    // CSV import/export: name,url,username,password,note (de facto format for password managers)
    const rows = [
      ["name", "url", "username", "password", "note"]
    ];

    itemsToExport.forEach(item => {
      const domain = extractDomain(item.url);
      const name = item.name || domain || "GenPass";
      const url = item.url || (domain ? `https://${domain}` : "");
      const username = item.username || "";
      const password = item.password;
      const note = item.note || (item.tag ? `Nhãn: ${item.tag}` : "");

      rows.push([
        escapeCsvCell(name),
        escapeCsvCell(url),
        escapeCsvCell(username),
        escapeCsvCell(password),
        escapeCsvCell(note)
      ]);
    });

    const csvContent = "﻿" + rows.map(r => r.join(",")).join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const dateStr = new Date().toISOString().slice(0, 10);
    const filterSuffix = activeFilterTag ? `_${activeFilterTag.replace(/\s+/g, "_")}` : "";
    a.href = blobUrl;
    a.download = `genpass_passwords${filterSuffix}_${dateStr}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);

    showToast(`Đã xuất ${itemsToExport.length} mật khẩu ra CSV!`);
  }

  function parseCsv(text) {
    if (!text) return [];
    const cleanText = text.replace(/^\uFEFF/, "");
    const rows = [];
    let currentRow = [];
    let currentVal = "";
    let insideQuote = false;

    for (let i = 0; i < cleanText.length; i++) {
      const ch = cleanText[i];
      const nextCh = cleanText[i + 1];

      if (insideQuote) {
        if (ch === '"') {
          if (nextCh === '"') {
            currentVal += '"';
            i++;
          } else {
            insideQuote = false;
          }
        } else {
          currentVal += ch;
        }
      } else {
        if (ch === '"') {
          insideQuote = true;
        } else if (ch === ',') {
          currentRow.push(currentVal);
          currentVal = "";
        } else if (ch === '\r') {
          if (nextCh === '\n') {
            i++;
          }
          currentRow.push(currentVal);
          currentVal = "";
          rows.push(currentRow);
          currentRow = [];
        } else if (ch === '\n') {
          currentRow.push(currentVal);
          currentVal = "";
          rows.push(currentRow);
          currentRow = [];
        } else {
          currentVal += ch;
        }
      }
    }

    if (currentVal || currentRow.length > 0) {
      currentRow.push(currentVal);
      rows.push(currentRow);
    }

    return rows;
  }

  function handleCsvImport(text) {
    if (!text || typeof text !== "string") {
      showToast("Nội dung không hợp lệ!");
      return { imported: 0, skipped: 0 };
    }
    const rawRows = parseCsv(text).filter(r => r.length > 0 && r.some(c => c.trim().length > 0));
    if (rawRows.length < 2) {
      showToast("File CSV không có dữ liệu hợp lệ!");
      return { imported: 0, skipped: 0 };
    }

    const headers = rawRows[0].map(h => h.trim().toLowerCase());
    let colPassword = headers.findIndex(h => h === "password" || h === "login_password" || h === "mật khẩu" || h === "mat khau");
    let colName = headers.findIndex(h => h === "name" || h === "title" || h === "tên" || h === "tiêu đề" || h === "dịch vụ" || h === "service");
    let colUser = headers.findIndex(h => h === "username" || h === "user" || h === "email" || h === "login_username" || h === "tài khoản" || h === "tên đăng nhập" || h === "tai khoan");
    let colUrl = headers.findIndex(h => h === "url" || h === "login_uri" || h === "website" || h === "link" || h === "trang web" || h === "địa chỉ");
    let colNote = headers.findIndex(h => h === "note" || h === "notes" || h === "tag" || h === "ghi chú" || h === "nhãn" || h === "ghi chu");

    if (colPassword === -1) {
      colPassword = headers.findIndex(h => h.includes("pass") || h.includes("mật") || h.includes("khẩu"));
    }
    if (colPassword === -1) {
      showToast("Không tìm thấy cột mật khẩu trong CSV!");
      return { imported: 0, skipped: 0 };
    }

    const existingPasswords = new Set(currentHistory.map(h => h.password));
    let importedCount = 0;
    let skippedCount = 0;
    let tagsChanged = false;

    for (let i = 1; i < rawRows.length; i++) {
      const row = rawRows[i];
      const password = (row[colPassword] || "").trim();
      if (!password) continue;

      if (existingPasswords.has(password)) {
        skippedCount++;
        continue;
      }

      existingPasswords.add(password);

      let rawName = colName !== -1 ? (row[colName] || "").trim() : "";
      let rawUser = colUser !== -1 ? (row[colUser] || "").trim() : "";
      let rawUrl = colUrl !== -1 ? (row[colUrl] || "").trim() : "";
      let rawNote = colNote !== -1 ? (row[colNote] || "").trim() : "";

      let tag = "";
      if (rawNote) {
        if (/^nhãn:\s*/i.test(rawNote)) {
          tag = rawNote.replace(/^nhãn:\s*/i, "").trim();
        } else if (rawNote.length <= 25) {
          tag = rawNote;
        }
      }

      if (tag && !currentTags.includes(tag)) {
        currentTags.push(tag);
        tagsChanged = true;
      }

      if (!rawName) {
        const domain = extractDomain(rawUrl);
        rawName = domain || "GenPass";
      }

      const item = {
        id: (Date.now() + i).toString(),
        name: rawName,
        username: rawUser,
        tag: tag,
        url: rawUrl,
        note: rawNote,
        password: password,
        length: password.length,
        createdAt: new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) + " " + new Date().toLocaleDateString("vi-VN")
      };

      currentHistory.unshift(item);
      importedCount++;
    }

    if (currentHistory.length > 200) {
      currentHistory = currentHistory.slice(0, 200);
    }

    if (tagsChanged) {
      saveTags();
      renderTags();
    }

    if (chrome?.storage?.local) {
      persistKey("genHistory", currentHistory);
    }

    updateHistoryUI();
    renderTagFilterBar();

    if (importedCount === 0) {
      showToast(skippedCount > 0 ? "Tất cả mật khẩu trong file đã có sẵn!" : "Không có mật khẩu nào được nhập!");
    } else {
      showToast(`Đã nhập ${importedCount} mật khẩu${skippedCount > 0 ? ` (bỏ qua ${skippedCount} trùng)` : ""}!`);
    }

    return { imported: importedCount, skipped: skippedCount };
  }

  function handleGenerate(autoSave = false) {
    const opts = getOptions();

    if (currentGenMode === "passphrase") {
      const pass = generatePassphrase({
        numWords: opts.passphraseWords,
        separator: opts.passphraseSeparator,
        capitalize: opts.passphraseCapitalize,
        includeNumber: opts.passphraseNumber
      });
      els.display.value = pass;

      const strength = calculatePassphraseStrength(
        opts.passphraseWords,
        opts.passphraseNumber,
        (typeof DICEWARE_WORDS !== "undefined" && Array.isArray(DICEWARE_WORDS)) ? DICEWARE_WORDS.length : 1296
      );
      els.strengthBar.style.width = `${strength.pct}%`;
      els.strengthBar.style.backgroundColor = strength.color;
      els.strengthText.textContent = strength.label;
      els.strengthText.style.color = strength.color;

      saveOptions(opts);
      if (autoSave) {
        saveHistoryItem(pass, els.passwordName?.value, els.passwordTag?.value, currentTabUrl, els.passwordNote?.value, els.passwordUser?.value);
      }
      return;
    }

    // Prevent turning all options off
    if (!opts.upper && !opts.lower && !opts.numbers && !opts.special) {
      els.optLower.checked = true;
      opts.lower = true;
    }

    const pass = generatePassword(opts);
    els.display.value = pass;

    const poolSize = getActivePoolSize(opts);
    const strength = calculateStrength(pass, poolSize);
    els.strengthBar.style.width = `${strength.pct}%`;
    els.strengthBar.style.backgroundColor = strength.color;
    els.strengthText.textContent = strength.label;
    els.strengthText.style.color = strength.color;

    saveOptions(opts);
    if (autoSave) {
      saveHistoryItem(pass, els.passwordName?.value, els.passwordTag?.value, currentTabUrl, els.passwordNote?.value, els.passwordUser?.value);
    }
  }

  // Event Listeners
  els.btnModePassword.addEventListener("click", () => {
    if (currentGenMode === "password") return;
    currentGenMode = "password";
    els.btnModePassword.classList.add("active");
    els.btnModePassphrase.classList.remove("active");
    els.panelModePassword.hidden = false;
    els.panelModePassphrase.hidden = true;
    handleGenerate(false);
  });

  els.btnModePassphrase.addEventListener("click", () => {
    if (currentGenMode === "passphrase") return;
    currentGenMode = "passphrase";
    els.btnModePassphrase.classList.add("active");
    els.btnModePassword.classList.remove("active");
    els.panelModePassword.hidden = true;
    els.panelModePassphrase.hidden = false;
    handleGenerate(false);
  });

  els.passphraseWordsRange.addEventListener("input", (e) => {
    els.passphraseWordsVal.textContent = e.target.value;
    handleGenerate(false);
  });

  [
    els.passphraseSeparator,
    els.optPassphraseCapitalize,
    els.optPassphraseNumber
  ].forEach(input => {
    input.addEventListener("change", () => handleGenerate(false));
  });

  els.lengthRange.addEventListener("input", (e) => {
    els.lengthVal.textContent = e.target.value;
    handleGenerate(false);
  });

  [
    els.optUpper,
    els.optLower,
    els.optNumbers,
    els.optSpecial,
    els.optAvoidAmbiguous,
    els.minNumbers,
    els.minSpecial
  ].forEach(input => {
    input.addEventListener("change", () => handleGenerate(false));
  });

  els.optAutoSavePrompt.addEventListener("change", () => {
    saveOptions(getOptions());
    showToast(els.optAutoSavePrompt.checked ? "Đã bật hỏi lưu mật khẩu!" : "Đã tắt hỏi lưu mật khẩu!");
  });

  els.optAutoFill.addEventListener("change", () => {
    saveOptions(getOptions());
    showToast(els.optAutoFill.checked ? "Đã bật gợi ý tự động điền!" : "Đã tắt gợi ý tự động điền!");
  });

  els.refresh.addEventListener("click", () => {
    handleGenerate(false);
    showToast("Đã tạo mật khẩu mới!");
  });

  els.copy.addEventListener("click", () => {
    if (!els.display.value) return;
    navigator.clipboard.writeText(els.display.value).then(() => {
      saveHistoryItem(els.display.value, els.passwordName?.value, els.passwordTag?.value, currentTabUrl, els.passwordNote?.value, els.passwordUser?.value);
      scheduleClipboardClear(els.display.value);
      showToast("Đã sao chép mật khẩu!");
    });
  });

  // Live search in history
  els.inputSearchHistory.addEventListener("input", (e) => {
    currentSearchQuery = e.target.value.trim().toLowerCase();
    els.btnClearSearch.hidden = !currentSearchQuery;
    updateHistoryUI();
  });

  els.btnClearSearch.addEventListener("click", () => {
    els.inputSearchHistory.value = "";
    currentSearchQuery = "";
    els.btnClearSearch.hidden = true;
    updateHistoryUI();
  });

  function compareVersions(v1, v2) {
    const p1 = (v1 || "").split(".").map(n => parseInt(n, 10) || 0);
    const p2 = (v2 || "").split(".").map(n => parseInt(n, 10) || 0);
    const len = Math.max(p1.length, p2.length);
    for (let i = 0; i < len; i++) {
      const num1 = p1[i] || 0;
      const num2 = p2[i] || 0;
      if (num1 > num2) return 1;
      if (num1 < num2) return -1;
    }
    return 0;
  }

  function showUpdateBanner(version) {
    if (!els.updateBanner) return;
    els.updateBanner.hidden = false;
    els.updateBanner.style.display = "flex";
    if (els.updateText) {
      els.updateText.textContent = `Đã có bản v${version} mới!`;
    }
  }

  function hideUpdateBanner() {
    if (!els.updateBanner) return;
    els.updateBanner.hidden = true;
    els.updateBanner.style.display = "none";
  }

  // Update banner logic with version check & dismiss button
  if (chrome?.storage?.local && chrome?.runtime?.getManifest) {
    const localVersion = chrome.runtime.getManifest().version;
    chrome.storage.local.get(["genUpdateInfo", "dismissedUpdateVer"], (res) => {
      const updateInfo = res?.genUpdateInfo;
      const dismissed = res?.dismissedUpdateVer;
      if (updateInfo?.remoteVersion) {
        const isNewer = compareVersions(updateInfo.remoteVersion, localVersion) > 0;
        if (isNewer && dismissed !== updateInfo.remoteVersion) {
          showUpdateBanner(updateInfo.remoteVersion);
        } else {
          hideUpdateBanner();
          if (!isNewer && chrome?.action?.setBadgeText) {
            chrome.action.setBadgeText({ text: "" });
          }
        }
      } else {
        hideUpdateBanner();
      }
    });
  } else {
    hideUpdateBanner();
  }

  if (els.btnDismissUpdate) {
    els.btnDismissUpdate.addEventListener("click", () => {
      hideUpdateBanner();
      chrome.storage.local.get(["genUpdateInfo"], (res) => {
        if (res?.genUpdateInfo?.remoteVersion) {
          chrome.storage.local.set({ dismissedUpdateVer: res.genUpdateInfo.remoteVersion });
        }
      });
    });
  }

  els.btnViewUpdate.addEventListener("click", () => {
    if (chrome?.tabs?.create) {
      chrome.tabs.create({ url: "https://github.com/lengoctuong2005/GenPass" });
    } else {
      window.open("https://github.com/lengoctuong2005/GenPass", "_blank");
    }
  });

  els.optAutoClearClipboard.addEventListener("change", () => {
    saveOptions(getOptions());
    showToast(els.optAutoClearClipboard.checked ? "Đã bật tự động xóa clipboard sau 30s!" : "Đã tắt tự động xóa clipboard!");
  });

  // --- Vault listeners ---
  if (els.optVaultEnabled) {
    els.optVaultEnabled.addEventListener("change", () => {
      if (els.optVaultEnabled.checked) {
        vaultPinMode = "set";
        vaultOpenPinModal("Đặt mã PIN bảo vệ kho");
      } else if (vaultOn) {
        vaultOpenDisableModal();
      } else {
        els.optVaultEnabled.checked = false;
      }
    });
  }

  if (els.optVaultLockClose) {
    els.optVaultLockClose.addEventListener("change", () => {
      vaultOpts.vaultLockClose = els.optVaultLockClose.checked;
      saveOptions(getOptions());
    });
  }

  if (els.optVaultTimeout) {
    els.optVaultTimeout.addEventListener("change", () => {
      vaultOpts.vaultTimeoutMin = vaultTimeoutMin();
      saveOptions(getOptions());
      vaultSyncSettings();
      // Ap dung ngay han moi thay vi cho nhip tim 20s ke tiep
      if (vaultOn && vaultKey) vaultSessionSet(vaultKey, vaultOpts.vaultTimeoutMin).catch(() => {});
      vaultHeartbeatStart();
    });
  }

  if (els.vaultPinNew) {
    els.vaultPinNew.addEventListener("input", vaultUpdatePinStrength);
  }

  if (els.btnVaultChangePin) {
    els.btnVaultChangePin.addEventListener("click", () => {
      vaultPinMode = "change";
      vaultOpenPinModal("Đổi mã PIN");
    });
  }

  if (els.vaultUnlockBtn) {
    els.vaultUnlockBtn.addEventListener("click", () => {
      vaultUnlock();
    });
  }

  if (els.vaultPin) {
    els.vaultPin.addEventListener("keydown", (e) => {
      if (e.key === "Enter") vaultUnlock();
    });
  }

  if (els.btnVaultPinSave) {
    els.btnVaultPinSave.addEventListener("click", () => {
      vaultSavePin();
    });
  }

  if (els.btnVaultPinCancel) {
    els.btnVaultPinCancel.addEventListener("click", () => {
      if (els.modalVaultPin) els.modalVaultPin.hidden = true;
      if (els.optVaultEnabled && !vaultOn) els.optVaultEnabled.checked = false;
    });
  }

  if (els.btnCloseVaultPin) {
    els.btnCloseVaultPin.addEventListener("click", () => {
      if (els.modalVaultPin) els.modalVaultPin.hidden = true;
      if (els.optVaultEnabled && !vaultOn) els.optVaultEnabled.checked = false;
    });
  }

  if (els.btnVaultOffConfirm) {
    els.btnVaultOffConfirm.addEventListener("click", () => {
      vaultDisableConfirm();
    });
  }

  if (els.btnVaultOffCancel) {
    els.btnVaultOffCancel.addEventListener("click", () => {
      if (els.modalVaultDisable) els.modalVaultDisable.hidden = true;
      if (els.optVaultEnabled) els.optVaultEnabled.checked = vaultOn;
    });
  }

  if (els.btnCloseVaultOff) {
    els.btnCloseVaultOff.addEventListener("click", () => {
      if (els.modalVaultDisable) els.modalVaultDisable.hidden = true;
      if (els.optVaultEnabled) els.optVaultEnabled.checked = vaultOn;
    });
  }

  if (els.modalVaultPin) {
    els.modalVaultPin.addEventListener("click", (e) => {
      if (e.target === els.modalVaultPin) {
        els.modalVaultPin.hidden = true;
        if (els.optVaultEnabled && !vaultOn) els.optVaultEnabled.checked = false;
      }
    });
  }

  if (els.modalVaultDisable) {
    els.modalVaultDisable.addEventListener("click", (e) => {
      if (e.target === els.modalVaultDisable) {
        els.modalVaultDisable.hidden = true;
        if (els.optVaultEnabled) els.optVaultEnabled.checked = vaultOn;
      }
    });
  }

  // Dong popup: chi ngat heartbeat va port "vault-session" cua chinh popup nay.
  // Thu hoi khoa phien khi dong popup do SW dem so cong "vault-session" (background.js)
  // quyet dinh. Khong tu xoa genVaultKey o day: se khoa nham popup/side panel khac dang mo.
  window.addEventListener("pagehide", () => {
    vaultSessionStop();
  });

  els.passwordName.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      els.copy.click();
    }
  });

  els.btnExportCsv.addEventListener("click", exportToCsv);

  function openImportModal() {
    if (els.modalImportCsv) {
      els.modalImportCsv.hidden = false;
      const isPopup = !window.location.search.includes("tab=") && window.innerWidth < 450;
      if (els.btnModalChooseFile) {
        els.btnModalChooseFile.textContent = isPopup ? "Chọn file CSV (Mở tab an toàn)" : "Chọn file CSV từ máy tính";
      }
      const helper = document.getElementById("import-tab-note");
      if (helper) {
        helper.textContent = isPopup
          ? "Trình duyệt tự tắt popup khi chọn file?"
          : "Đang ở chế độ tab: Hộp thoại file không làm tắt trang.";
      }
    }
  }

  function closeImportModal() {
    if (els.modalImportCsv) {
      els.modalImportCsv.hidden = true;
      if (els.textareaImportCsv) {
        els.textareaImportCsv.value = "";
      }
    }
  }

  els.btnImportCsv.addEventListener("click", openImportModal);
  if (els.btnCloseImportModal) {
    els.btnCloseImportModal.addEventListener("click", closeImportModal);
  }
  if (els.modalImportCsv) {
    els.modalImportCsv.addEventListener("click", (e) => {
      if (e.target === els.modalImportCsv) closeImportModal();
    });
  }

  function handleChooseFileClick() {
    const isPopup = !window.location.search.includes("tab=") && window.innerWidth < 450;
    if (isPopup) {
      const tabUrl = chrome?.runtime?.getURL ? chrome.runtime.getURL("popup.html?tab=history&open=import") : "popup.html?tab=history&open=import";
      if (chrome?.tabs?.create) {
        chrome.tabs.create({ url: tabUrl });
      } else {
        window.open(tabUrl, "_blank");
      }
      return;
    }
    selectAndImportCsv();
  }

  async function selectAndImportCsv() {
    if (typeof window.showOpenFilePicker === "function") {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: [{
            description: "File CSV",
            accept: {
              "text/csv": [".csv"],
              "text/plain": [".csv", ".txt"]
            }
          }],
          multiple: false
        });
        const file = await handle.getFile();
        const text = await file.text();
        const res = handleCsvImport(text);
        if (res && (res.imported > 0 || res.skipped > 0)) {
          closeImportModal();
        }
        return;
      } catch (err) {
        if (err.name === "AbortError") return;
        console.warn("showOpenFilePicker fallback:", err);
      }
    }
    els.inputImportCsv.click();
  }

  if (els.btnModalChooseFile) {
    els.btnModalChooseFile.addEventListener("click", (e) => {
      e.stopPropagation();
      handleChooseFileClick();
    });
  }

  if (els.csvDropZone) {
    els.csvDropZone.addEventListener("click", (e) => {
      if (e.target !== els.btnModalChooseFile) {
        handleChooseFileClick();
      }
    });

    els.csvDropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      els.csvDropZone.classList.add("drag-over");
    });

    els.csvDropZone.addEventListener("dragleave", (e) => {
      e.stopPropagation();
      els.csvDropZone.classList.remove("drag-over");
    });

    els.csvDropZone.addEventListener("drop", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      els.csvDropZone.classList.remove("drag-over");
      const file = e.dataTransfer?.files?.[0];
      if (file) {
        try {
          const text = await file.text();
          const res = handleCsvImport(text);
          if (res && (res.imported > 0 || res.skipped > 0)) {
            closeImportModal();
          }
        } catch (err) {
          showToast("Lỗi khi đọc file: " + err.message);
        }
      }
    });
  }

  // Direct Drag & Drop on History View
  els.viewHistory.addEventListener("dragover", (e) => {
    e.preventDefault();
    els.viewHistory.classList.add("drag-target");
  });

  els.viewHistory.addEventListener("dragleave", (e) => {
    if (!els.viewHistory.contains(e.relatedTarget)) {
      els.viewHistory.classList.remove("drag-target");
    }
  });

  els.viewHistory.addEventListener("drop", async (e) => {
    e.preventDefault();
    els.viewHistory.classList.remove("drag-target");
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      try {
        const text = await file.text();
        handleCsvImport(text);
      } catch (err) {
        showToast("Lỗi khi đọc file: " + err.message);
      }
    }
  });

  if (els.btnModalImportText) {
    els.btnModalImportText.addEventListener("click", () => {
      const text = els.textareaImportCsv.value.trim();
      if (!text) {
        showToast("Vui lòng dán nội dung CSV!");
        return;
      }
      const res = handleCsvImport(text);
      if (res && (res.imported > 0 || res.skipped > 0)) {
        closeImportModal();
      }
    });
  }

  if (els.btnOpenTabImport) {
    els.btnOpenTabImport.addEventListener("click", () => {
      const url = chrome?.runtime?.getURL ? chrome.runtime.getURL("popup.html?tab=history&open=import") : "popup.html?tab=history&open=import";
      if (chrome?.tabs?.create) {
        chrome.tabs.create({ url });
      } else {
        window.open(url, "_blank");
      }
    });
  }

  els.inputImportCsv.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const res = handleCsvImport(text);
      if (res && (res.imported > 0 || res.skipped > 0)) {
        closeImportModal();
      }
    } catch (err) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        const content = evt.target?.result;
        if (typeof content === "string") {
          const res = handleCsvImport(content);
          if (res && (res.imported > 0 || res.skipped > 0)) {
            closeImportModal();
          }
        }
      };
      reader.readAsText(file);
    } finally {
      els.inputImportCsv.value = "";
    }
  });

  els.toggleMask.addEventListener("click", () => {
    isMasked = !isMasked;
    els.display.type = isMasked ? "password" : "text";
    els.toggleMask.title = isMasked ? "Hiện mật khẩu" : "Ẩn mật khẩu";
    saveOptions(getOptions());
  });

  // Modal Tag Management
  els.btnOpenTags.addEventListener("click", () => {
    els.modalTags.hidden = false;
    renderTagsManageList();
    els.inputNewTag.focus();
  });

  els.btnCloseModal.addEventListener("click", () => {
    els.modalTags.hidden = true;
  });

  els.modalTags.addEventListener("click", (e) => {
    if (e.target === els.modalTags) {
      els.modalTags.hidden = true;
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!els.modalTags.hidden) {
        els.modalTags.hidden = true;
      }
      if (els.modalImportCsv && !els.modalImportCsv.hidden) {
        closeImportModal();
      }
      if (els.modalVaultPin && !els.modalVaultPin.hidden) {
        els.modalVaultPin.hidden = true;
        if (els.optVaultEnabled && !vaultOn) els.optVaultEnabled.checked = false;
      }
      if (els.modalVaultDisable && !els.modalVaultDisable.hidden) {
        els.modalVaultDisable.hidden = true;
        if (els.optVaultEnabled) els.optVaultEnabled.checked = vaultOn;
      }
    }
  });

  function handleAddTag() {
    const val = els.inputNewTag.value.trim();
    if (!val) return;
    if (currentTags.includes(val)) {
      showToast("Nhãn đã tồn tại!");
      return;
    }
    currentTags.push(val);
    saveTags();
    els.inputNewTag.value = "";
    renderTags();
    showToast(`Đã thêm nhãn "${val}"!`);
  }

  els.btnAddTag.addEventListener("click", handleAddTag);
  els.inputNewTag.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleAddTag();
  });

  // Tab switching
  function switchTab(tabEl, viewEl) {
    [els.tabGen, els.tabHistory, els.tab2Fa, els.tabCards, els.tabCookies].forEach(t => t?.classList.remove("active"));
    [els.viewGen, els.viewHistory, els.view2Fa, els.viewCards, els.viewCookies].forEach(v => v?.classList.remove("active"));
    tabEl?.classList.add("active");
    viewEl?.classList.add("active");
    if (viewEl === els.view2Fa) {
      render2FA();
    } else if (viewEl === els.viewCards) {
      renderCards();
    } else if (viewEl === els.viewCookies) {
      renderCookieProfiles();
    }
  }

  els.tabGen.addEventListener("click", () => switchTab(els.tabGen, els.viewGen));
  els.tabHistory.addEventListener("click", () => switchTab(els.tabHistory, els.viewHistory));
  els.tab2Fa.addEventListener("click", () => switchTab(els.tab2Fa, els.view2Fa));
  if (els.tabCards && els.viewCards) {
    els.tabCards.addEventListener("click", () => switchTab(els.tabCards, els.viewCards));
  }
  if (els.tabCookies && els.viewCookies) {
    els.tabCookies.addEventListener("click", () => switchTab(els.tabCookies, els.viewCookies));
  }

  // 2FA Add/Cancel/Save
  els.btnToggleAdd2Fa.addEventListener("click", () => {
    els.cardAdd2Fa.hidden = !els.cardAdd2Fa.hidden;
    if (!els.cardAdd2Fa.hidden) {
      els.input2FaName.focus();
    }
  });

  els.btnCancel2Fa.addEventListener("click", () => {
    els.cardAdd2Fa.hidden = true;
    els.input2FaName.value = "";
    els.input2FaSecret.value = "";
  });

  els.btnSave2Fa.addEventListener("click", () => {
    const rawSecret = els.input2FaSecret.value.trim();
    if (!rawSecret) {
      showToast("Vui lòng nhập khóa bí mật!");
      return;
    }

    let name = els.input2FaName.value.trim();
    let account = "";
    let secret = rawSecret;

    if (rawSecret.startsWith("otpauth://")) {
      const parsed = parseOtpAuthUrl(rawSecret);
      if (parsed) {
        name = name || parsed.name;
        account = parsed.account;
        secret = parsed.secret;
      }
    }

    secret = secret.replace(/\s+/g, "").toUpperCase();
    const decoded = base32Decode(secret);
    if (decoded.length === 0) {
      showToast("Khóa bí mật Base32 không hợp lệ!");
      return;
    }

    if (!name) name = "2FA Account";

    const newItem = {
      id: Date.now().toString(),
      name: name,
      account: account,
      secret: secret,
      createdAt: new Date().toLocaleTimeString("vi-VN")
    };

    current2FA.unshift(newItem);
    if (chrome?.storage?.local) {
      persistKey("gen2FA", current2FA);
    }

    els.cardAdd2Fa.hidden = true;
    els.input2FaName.value = "";
    els.input2FaSecret.value = "";
    render2FA();
    showToast(`Đã thêm mã 2FA "${name}"!`);
  });

  // QR Code Scanning events
  els.btnScanQr.addEventListener("click", () => {
    showToast("Đang quét màn hình tìm mã QR...");
    if (chrome?.tabs?.captureVisibleTab) {
      chrome.tabs.captureVisibleTab({ format: "png" }, (dataUrl) => {
        if (chrome.runtime.lastError || !dataUrl) {
          const err = chrome.runtime.lastError?.message || "";
          tryScanFromActiveTab(err.includes("Cannot access") ? "Không thể quét trên trang hệ thống của trình duyệt!" : "");
          return;
        }
        processImageFileOrDataUrl(dataUrl, () => {
          // If screenshot doesn't yield QR, check active tab DOM elements
          tryScanFromActiveTab();
        });
      });
    } else {
      tryScanFromActiveTab("Trình duyệt không hỗ trợ chụp tab!");
    }
  });

  els.btnUploadQr.addEventListener("click", () => {
    els.inputQrFile.click();
  });

  els.inputQrFile.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      if (typeof evt.target?.result === "string") {
        processImageFileOrDataUrl(evt.target.result);
      }
      els.inputQrFile.value = "";
    };
    reader.readAsDataURL(file);
  });

  // Paste image handler for QR code
  window.addEventListener("paste", (e) => {
    if (!els.view2Fa.classList.contains("active")) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = (evt) => {
            if (typeof evt.target?.result === "string") {
              processImageFileOrDataUrl(evt.target.result);
            }
          };
          reader.readAsDataURL(file);
          break;
        }
      }
    }
  });

  els.btnClearHistory.addEventListener("click", () => {
    if (currentHistory.length === 0) return;
    currentHistory = [];
    updateHistoryUI();
    renderTagFilterBar();
    if (chrome?.storage?.local) {
      persistKey("genHistory", []);
    }
    showToast("Đã xóa toàn bộ lịch sử.");
  });

  // --- Payment Cards Management ---
  function saveCards() {
    if (chrome?.storage?.local) {
      persistKey("genCards", currentCards);
    }
  }

  function updateCardBrandUI(num) {
    if (!els.cardBrandBadge) return;
    const { brand, code } = detectCardBrand(num);
    els.cardBrandBadge.textContent = brand;
    els.cardBrandBadge.className = "card-brand-badge" + (code !== "generic" ? " " + code : "");
  }

  function renderCards() {
    if (!els.countCards || !els.listCards) return;
    els.countCards.textContent = currentCards.length;
    els.listCards.innerHTML = "";

    let filtered = currentCards;
    if (currentCardsSearchQuery) {
      const q = currentCardsSearchQuery.toLowerCase();
      filtered = currentCards.filter(c => {
        const name = (c.cardName || "").toLowerCase();
        const holder = (c.cardholderName || "").toLowerCase();
        const num = (c.cardNumber || "").replace(/\s+/g, "");
        const note = (c.note || "").toLowerCase();
        return name.includes(q) || holder.includes(q) || num.includes(q) || note.includes(q);
      });
    }

    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = currentCardsSearchQuery
        ? `Không tìm thấy thẻ nào khớp với "${currentCardsSearchQuery}".`
        : 'Chưa có thẻ thanh toán nào. Bấm "+ Thêm thẻ" để lưu thẻ mới.';
      els.listCards.appendChild(empty);
      return;
    }

    filtered.forEach(card => {
      const brandInfo = detectCardBrand(card.cardNumber);
      const cardEl = document.createElement("div");
      cardEl.className = `payment-card-item brand-${brandInfo.code}`;

      // Top row
      const topRow = document.createElement("div");
      topRow.className = "payment-card-top";

      const chipGroup = document.createElement("div");
      chipGroup.className = "payment-card-chip";
      const chipGraphic = document.createElement("div");
      chipGraphic.className = "chip-graphic";
      const cardName = document.createElement("span");
      cardName.className = "payment-card-name";
      cardName.textContent = card.cardName || "Thẻ thanh toán";
      cardName.title = card.cardName || "Thẻ thanh toán";
      chipGroup.appendChild(chipGraphic);
      chipGroup.appendChild(cardName);

      const brandTag = document.createElement("span");
      brandTag.className = "payment-card-brand-tag";
      brandTag.textContent = brandInfo.brand;

      topRow.appendChild(chipGroup);
      topRow.appendChild(brandTag);

      // Number row
      const numRow = document.createElement("div");
      numRow.className = "payment-card-number-row";

      const isUnmasked = unmaskedCardNumbers.has(card.id);
      const numSpan = document.createElement("span");
      numSpan.className = "payment-card-masked-number";
      numSpan.textContent = isUnmasked ? formatCardNumber(card.cardNumber) : maskCardNumber(card.cardNumber);
      numSpan.title = "Bấm để sao chép số thẻ";
      numSpan.addEventListener("click", () => {
        const clean = (card.cardNumber || "").replace(/\s+/g, "");
        navigator.clipboard.writeText(clean);
        scheduleClipboardClear(clean);
        showToast("Đã sao chép số thẻ!");
      });

      const numActions = document.createElement("div");
      numActions.className = "payment-card-number-actions";

      const toggleMaskBtn = document.createElement("button");
      toggleMaskBtn.type = "button";
      toggleMaskBtn.className = "icon-btn-card";
      toggleMaskBtn.title = isUnmasked ? "Ẩn số thẻ" : "Hiện số thẻ";
      toggleMaskBtn.innerHTML = isUnmasked
        ? `<svg class="icon-small" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`
        : `<svg class="icon-small" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
      toggleMaskBtn.addEventListener("click", () => {
        if (unmaskedCardNumbers.has(card.id)) {
          unmaskedCardNumbers.delete(card.id);
        } else {
          unmaskedCardNumbers.add(card.id);
        }
        renderCards();
      });

      const copyNumBtn = document.createElement("button");
      copyNumBtn.type = "button";
      copyNumBtn.className = "icon-btn-card";
      copyNumBtn.title = "Sao chép số thẻ";
      copyNumBtn.innerHTML = `<svg class="icon-small" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
      copyNumBtn.addEventListener("click", () => {
        const clean = (card.cardNumber || "").replace(/\s+/g, "");
        navigator.clipboard.writeText(clean);
        scheduleClipboardClear(clean);
        showToast("Đã sao chép số thẻ!");
      });

      numActions.appendChild(toggleMaskBtn);
      numActions.appendChild(copyNumBtn);

      numRow.appendChild(numSpan);
      numRow.appendChild(numActions);

      // Bottom row (Holder, Exp, CVV, actions)
      const bottomRow = document.createElement("div");
      bottomRow.className = "payment-card-bottom";

      const holderGroup = document.createElement("div");
      holderGroup.className = "payment-card-holder-group";
      const holderLabel = document.createElement("span");
      holderLabel.className = "payment-card-label";
      holderLabel.textContent = "CHỦ THẺ";
      const holderVal = document.createElement("span");
      holderVal.className = "payment-card-holder";
      holderVal.textContent = card.cardholderName || "CHƯA TÊN";
      holderVal.title = "Bấm để sao chép tên chủ thẻ";
      holderVal.addEventListener("click", () => {
        if (card.cardholderName) {
          navigator.clipboard.writeText(card.cardholderName);
          scheduleClipboardClear(card.cardholderName);
          showToast("Đã sao chép tên chủ thẻ!");
        }
      });
      holderGroup.appendChild(holderLabel);
      holderGroup.appendChild(holderVal);

      const expGroup = document.createElement("div");
      expGroup.className = "payment-card-exp-group";
      const expLabel = document.createElement("span");
      expLabel.className = "payment-card-label";
      expLabel.textContent = "HẾT HẠN";
      const expVal = document.createElement("span");
      expVal.className = "payment-card-exp";
      expVal.textContent = card.expiryDate || "--/--";
      expVal.title = "Bấm để sao chép ngày hết hạn";
      expVal.addEventListener("click", () => {
        if (card.expiryDate) {
          navigator.clipboard.writeText(card.expiryDate);
          scheduleClipboardClear(card.expiryDate);
          showToast("Đã sao chép hạn thẻ!");
        }
      });
      expGroup.appendChild(expLabel);
      expGroup.appendChild(expVal);

      const cvvGroup = document.createElement("div");
      cvvGroup.className = "payment-card-cvv-group";
      const cvvLabel = document.createElement("span");
      cvvLabel.className = "payment-card-label";
      cvvLabel.textContent = "CVV";
      const cvvVal = document.createElement("span");
      cvvVal.className = "payment-card-cvv";
      cvvVal.textContent = isUnmasked ? (card.cvv || "•••") : "•••";
      cvvVal.title = "Bấm để sao chép mã CVV";
      cvvVal.addEventListener("click", () => {
        if (card.cvv) {
          navigator.clipboard.writeText(card.cvv);
          scheduleClipboardClear(card.cvv);
          showToast("Đã sao chép mã CVV!");
        }
      });
      cvvGroup.appendChild(cvvLabel);
      cvvGroup.appendChild(cvvVal);

      const cardActions = document.createElement("div");
      cardActions.className = "payment-card-actions";

      const copyAllBtn = document.createElement("button");
      copyAllBtn.type = "button";
      copyAllBtn.className = "icon-btn-card";
      copyAllBtn.title = "Sao chép tất cả thông tin thanh toán (Google Pay / PayPal)";
      copyAllBtn.innerHTML = `<svg class="icon-small" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`;
      copyAllBtn.addEventListener("click", () => {
        const lines = [
          `Hồ sơ: ${card.cardName || "Thanh toán"}`,
          `Chủ thẻ: ${card.cardholderName || ""}`,
          `Số thẻ: ${formatCardNumber(card.cardNumber || "")}`,
          `Hạn thẻ: ${card.expiryDate || ""}`,
          `CVV: ${card.cvv || ""}`
        ];
        if (card.email) lines.push(`Email: ${card.email}`);
        if (card.phone) lines.push(`SĐT: ${card.phone}`);
        if (card.address) lines.push(`Địa chỉ: ${card.address}`);
        if (card.city || card.state || card.zip) {
          lines.push(`Thành phố / Vùng / Zip: ${[card.city, card.state, card.zip].filter(Boolean).join(", ")}`);
        }
        if (card.country) lines.push(`Quốc gia: ${card.country}`);
        if (card.note) lines.push(`Ghi chú: ${card.note}`);

        const summary = lines.join("\n");
        navigator.clipboard.writeText(summary);
        scheduleClipboardClear(summary);
        showToast("Đã sao chép toàn bộ thông tin thanh toán!");
      });

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "icon-btn-card";
      editBtn.title = "Sửa hồ sơ thanh toán";
      editBtn.innerHTML = `<svg class="icon-small" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>`;
      editBtn.addEventListener("click", () => {
        editingCardId = card.id;
        els.cardAddCard.hidden = false;
        els.inputCardName.value = card.cardName || "";
        els.inputCardHolder.value = card.cardholderName || "";
        els.inputCardNumber.value = formatCardNumber(card.cardNumber || "");
        updateCardBrandUI(card.cardNumber);
        els.inputCardExp.value = card.expiryDate || "";
        els.inputCardCvv.value = card.cvv || "";
        if (els.inputCardEmail) els.inputCardEmail.value = card.email || "";
        if (els.inputCardPhone) els.inputCardPhone.value = card.phone || "";
        if (els.inputCardAddress) els.inputCardAddress.value = card.address || "";
        if (els.inputCardCity) els.inputCardCity.value = card.city || "";
        if (els.inputCardState) els.inputCardState.value = card.state || "";
        if (els.inputCardZip) els.inputCardZip.value = card.zip || "";
        if (els.inputCardCountry) els.inputCardCountry.value = card.country || "";
        els.inputCardNote.value = card.note || "";
        els.btnSaveCard.textContent = "Cập nhật";
        els.inputCardName.focus();
      });

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "icon-btn-card danger";
      delBtn.title = "Xóa hồ sơ thanh toán";
      delBtn.innerHTML = `<svg class="icon-small" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
      delBtn.addEventListener("click", () => {
        currentCards = currentCards.filter(c => c.id !== card.id);
        saveCards();
        renderCards();
        showToast(`Đã xóa hồ sơ "${card.cardName || "thanh toán"}"!`);
      });

      cardActions.appendChild(copyAllBtn);
      cardActions.appendChild(editBtn);
      cardActions.appendChild(delBtn);

      bottomRow.appendChild(holderGroup);
      bottomRow.appendChild(expGroup);
      bottomRow.appendChild(cvvGroup);
      bottomRow.appendChild(cardActions);

      cardEl.appendChild(topRow);
      cardEl.appendChild(numRow);
      cardEl.appendChild(bottomRow);

      // Billing Address / Google Payment block
      const hasBilling = card.address || card.city || card.zip || card.email || card.phone;
      if (hasBilling) {
        const billingBox = document.createElement("div");
        billingBox.className = "payment-card-billing-row";

        if (card.address || card.city || card.zip) {
          const addrSpan = document.createElement("span");
          const addrParts = [];
          if (card.address) addrParts.push(card.address);
          if (card.city) addrParts.push(card.city);
          if (card.state) addrParts.push(card.state);
          if (card.zip) addrParts.push(`ZIP: ${card.zip}`);
          if (card.country) addrParts.push(card.country);
          const fullAddr = addrParts.join(", ");
          addrSpan.textContent = `📍 ${fullAddr}`;
          addrSpan.title = "Bấm để sao chép địa chỉ thanh toán";
          addrSpan.addEventListener("click", () => {
            navigator.clipboard.writeText(fullAddr);
            scheduleClipboardClear(fullAddr);
            showToast("Đã sao chép địa chỉ thanh toán!");
          });
          billingBox.appendChild(addrSpan);
        }

        if (card.email || card.phone) {
          const contactSpan = document.createElement("span");
          const contactParts = [];
          if (card.email) contactParts.push(`✉️ ${card.email}`);
          if (card.phone) contactParts.push(`📞 ${card.phone}`);
          contactSpan.textContent = contactParts.join(" • ");
          contactSpan.title = "Bấm để sao chép liên hệ";
          contactSpan.addEventListener("click", () => {
            const contactText = [card.email, card.phone].filter(Boolean).join(" ");
            navigator.clipboard.writeText(contactText);
            scheduleClipboardClear(contactText);
            showToast("Đã sao chép liên hệ thanh toán!");
          });
          billingBox.appendChild(contactSpan);
        }

        cardEl.appendChild(billingBox);
      }

      if (card.note) {
        const noteEl = document.createElement("div");
        noteEl.className = "payment-card-note";
        noteEl.textContent = `📝 ${card.note}`;
        noteEl.title = "Bấm để sao chép ghi chú";
        noteEl.addEventListener("click", () => {
          navigator.clipboard.writeText(card.note);
          scheduleClipboardClear(card.note);
          showToast("Đã sao chép ghi chú thẻ!");
        });
        cardEl.appendChild(noteEl);
      }

      els.listCards.appendChild(cardEl);
    });
  }

  if (els.btnToggleAddCard) {
    els.btnToggleAddCard.addEventListener("click", () => {
      editingCardId = null;
      els.btnSaveCard.textContent = "Lưu hồ sơ";
      els.cardAddCard.hidden = !els.cardAddCard.hidden;
      if (!els.cardAddCard.hidden) {
        els.inputCardName.value = "";
        els.inputCardHolder.value = "";
        els.inputCardNumber.value = "";
        updateCardBrandUI("");
        els.inputCardExp.value = "";
        els.inputCardCvv.value = "";
        if (els.inputCardEmail) els.inputCardEmail.value = "";
        if (els.inputCardPhone) els.inputCardPhone.value = "";
        if (els.inputCardAddress) els.inputCardAddress.value = "";
        if (els.inputCardCity) els.inputCardCity.value = "";
        if (els.inputCardState) els.inputCardState.value = "";
        if (els.inputCardZip) els.inputCardZip.value = "";
        if (els.inputCardCountry) els.inputCardCountry.value = "";
        els.inputCardNote.value = "";
        els.inputCardName.focus();
      }
    });
  }

  if (els.btnCancelCard) {
    els.btnCancelCard.addEventListener("click", () => {
      els.cardAddCard.hidden = true;
      editingCardId = null;
    });
  }

  if (els.inputCardNumber) {
    els.inputCardNumber.addEventListener("input", (e) => {
      const formatted = formatCardNumber(e.target.value);
      e.target.value = formatted;
      updateCardBrandUI(formatted);
    });
  }

  if (els.inputCardExp) {
    els.inputCardExp.addEventListener("input", (e) => {
      e.target.value = formatExpiryDate(e.target.value);
    });
  }

  if (els.btnToggleCardCvv) {
    els.btnToggleCardCvv.addEventListener("click", () => {
      isCardCvvMasked = !isCardCvvMasked;
      els.inputCardCvv.type = isCardCvvMasked ? "password" : "text";
    });
  }

  if (els.btnSaveCard) {
    els.btnSaveCard.addEventListener("click", () => {
      const rawNumber = (els.inputCardNumber.value || "").replace(/\s+/g, "");
      if (!rawNumber) {
        showToast("Vui lòng nhập số thẻ!");
        return;
      }

      if (rawNumber.length < 12) {
        showToast("Số thẻ quá ngắn (tối thiểu 12 số)!");
        return;
      }

      const exp = (els.inputCardExp.value || "").trim();
      if (exp && !validateExpiryDate(exp)) {
        showToast("Hạn thẻ không hợp lệ (định dạng MM/YY, ví dụ 12/28)!");
        return;
      }

      const name = (els.inputCardName.value || "").trim() || "Thẻ thanh toán";
      const holder = (els.inputCardHolder.value || "").trim().toUpperCase();
      const cvv = (els.inputCardCvv.value || "").trim();
      const email = (els.inputCardEmail?.value || "").trim();
      const phone = (els.inputCardPhone?.value || "").trim();
      const address = (els.inputCardAddress?.value || "").trim();
      const city = (els.inputCardCity?.value || "").trim();
      const state = (els.inputCardState?.value || "").trim();
      const zip = (els.inputCardZip?.value || "").trim();
      const country = (els.inputCardCountry?.value || "").trim();
      const note = (els.inputCardNote.value || "").trim();
      const brandInfo = detectCardBrand(rawNumber);

      const cardPayload = {
        cardName: name,
        cardholderName: holder,
        cardNumber: rawNumber,
        expiryDate: exp,
        cvv: cvv,
        cardType: brandInfo.code,
        email,
        phone,
        address,
        city,
        state,
        zip,
        country,
        note
      };

      if (editingCardId) {
        const idx = currentCards.findIndex(c => c.id === editingCardId);
        if (idx !== -1) {
          currentCards[idx] = {
            ...currentCards[idx],
            ...cardPayload,
            updatedAt: new Date().toLocaleTimeString("vi-VN")
          };
        }
        showToast(`Đã cập nhật hồ sơ "${name}"!`);
      } else {
        const newCard = {
          id: Date.now().toString(),
          ...cardPayload,
          createdAt: new Date().toLocaleTimeString("vi-VN")
        };
        currentCards.unshift(newCard);
        showToast(`Đã lưu hồ sơ "${name}"!`);
      }

      saveCards();
      els.cardAddCard.hidden = true;
      editingCardId = null;
      renderCards();
    });
  }

  if (els.inputSearchCards) {
    els.inputSearchCards.addEventListener("input", (e) => {
      currentCardsSearchQuery = e.target.value.trim().toLowerCase();
      if (els.btnClearCardsSearch) {
        els.btnClearCardsSearch.hidden = !currentCardsSearchQuery;
      }
      renderCards();
    });
  }

  if (els.btnClearCardsSearch) {
    els.btnClearCardsSearch.addEventListener("click", () => {
      els.inputSearchCards.value = "";
      currentCardsSearchQuery = "";
      els.btnClearCardsSearch.hidden = true;
      renderCards();
    });
  }

  // --- Cookie Management (Multi-Account & Session Switcher) ---
  function prepareCookieForSet(targetUrl, c) {
    let cleanUrl = targetUrl;
    if (!cleanUrl || (!cleanUrl.startsWith("http://") && !cleanUrl.startsWith("https://"))) {
      const cleanDomain = c.domain ? c.domain.replace(/^\./, "") : "example.com";
      cleanUrl = `https://${cleanDomain}`;
    }
    const clean = {
      url: cleanUrl,
      name: c.name,
      value: c.value || "",
      path: c.path || "/"
    };
    if (c.domain && !c.hostOnly) {
      clean.domain = c.domain;
    }
    if (c.secure !== undefined) clean.secure = !!c.secure;
    if (c.httpOnly !== undefined) clean.httpOnly = !!c.httpOnly;
    if (c.sameSite && ["no_restriction", "lax", "strict"].includes(c.sameSite)) {
      clean.sameSite = c.sameSite;
    }
    if (c.expirationDate) clean.expirationDate = c.expirationDate;
    return clean;
  }

  function saveCookieProfiles() {
    if (chrome?.storage?.local) {
      persistKey("genCookieProfiles", currentCookieProfiles);
    }
  }

  function getActiveTabDomain() {
    return extractDomain(currentTabUrl);
  }

  function renderCookieFilterBar() {
    if (!els.cookiesFilterBar) return;
    els.cookiesFilterBar.innerHTML = "";

    const currentDomain = getActiveTabDomain();

    // 1. "Tất cả" chip
    const allChip = document.createElement("button");
    allChip.type = "button";
    allChip.className = "tag-filter-chip" + (activeCookieDomainFilter === "" ? " active" : "");
    allChip.textContent = `Tất cả (${currentCookieProfiles.length})`;
    allChip.addEventListener("click", () => {
      activeCookieDomainFilter = "";
      renderCookieFilterBar();
      renderCookieProfilesList();
    });
    els.cookiesFilterBar.appendChild(allChip);

    // 2. "Trang này" chip if on web
    if (currentDomain) {
      const currentDomainCount = currentCookieProfiles.filter(p => p.domain === currentDomain || (p.domain && (p.domain.includes(currentDomain) || currentDomain.includes(p.domain)))).length;
      const currentChip = document.createElement("button");
      currentChip.type = "button";
      currentChip.className = "tag-filter-chip" + (activeCookieDomainFilter === currentDomain ? " active" : "");
      currentChip.textContent = `Trang này (${currentDomainCount})`;
      currentChip.addEventListener("click", () => {
        activeCookieDomainFilter = (activeCookieDomainFilter === currentDomain) ? "" : currentDomain;
        renderCookieFilterBar();
        renderCookieProfilesList();
      });
      els.cookiesFilterBar.appendChild(currentChip);
    }

    // 3. Distinct other domains
    const domains = Array.from(new Set(currentCookieProfiles.map(p => p.domain).filter(Boolean)));
    domains.forEach(d => {
      if (d === currentDomain) return; // already added above
      const count = currentCookieProfiles.filter(p => p.domain === d).length;
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "tag-filter-chip" + (activeCookieDomainFilter === d ? " active" : "");
      chip.textContent = `${d} (${count})`;
      chip.addEventListener("click", () => {
        activeCookieDomainFilter = (activeCookieDomainFilter === d) ? "" : d;
        renderCookieFilterBar();
        renderCookieProfilesList();
      });
      els.cookiesFilterBar.appendChild(chip);
    });
  }

  function renderCookieProfiles() {
    renderCookieFilterBar();
    renderCookieProfilesList();
  }

  function renderCookieProfilesList() {
    if (!els.countCookies || !els.listCookieProfiles) return;
    const currentDomain = getActiveTabDomain();
    if (els.cookiesCurrentDomain) {
      els.cookiesCurrentDomain.textContent = currentDomain || "Chưa mở web";
      els.cookiesCurrentDomain.title = currentTabUrl || "Trang hiện tại";
    }

    els.countCookies.textContent = currentCookieProfiles.length;
    els.listCookieProfiles.innerHTML = "";

    let filtered = currentCookieProfiles;
    if (activeCookieDomainFilter) {
      filtered = filtered.filter(p => p.domain === activeCookieDomainFilter || (p.domain && (p.domain.includes(activeCookieDomainFilter) || activeCookieDomainFilter.includes(p.domain))));
    }

    if (currentCookiesSearchQuery) {
      const q = currentCookiesSearchQuery.toLowerCase();
      filtered = filtered.filter(p => {
        const name = (p.profileName || "").toLowerCase();
        const d = (p.domain || "").toLowerCase();
        return name.includes(q) || d.includes(q);
      });
    }

    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      if (currentCookiesSearchQuery) {
        empty.textContent = `Không tìm thấy phiên nào khớp với "${currentCookiesSearchQuery}".`;
      } else if (activeCookieDomainFilter) {
        empty.textContent = `Chưa có phiên lưu trữ nào cho ${activeCookieDomainFilter}. Bấm "+ Lưu phiên" để lưu tài khoản trang này.`;
      } else {
        empty.textContent = 'Chưa có phiên cookies nào được lưu. Mở một trang web (như Facebook, Shopee...) và bấm "+ Lưu phiên".';
      }
      els.listCookieProfiles.appendChild(empty);
      return;
    }

    filtered.forEach(profile => {
      const itemEl = document.createElement("div");
      itemEl.className = "cookie-profile-item";

      const topRow = document.createElement("div");
      topRow.className = "cookie-profile-top";

      const nameEl = document.createElement("span");
      nameEl.className = "cookie-profile-name";
      nameEl.textContent = profile.profileName || "Phiên không tên";
      nameEl.title = "Bấm để đổi tên phiên";

      const badgeGroup = document.createElement("div");
      badgeGroup.style.display = "flex";
      badgeGroup.style.alignItems = "center";
      badgeGroup.style.gap = "4px";

      if (profile.domain) {
        const domainBadge = document.createElement("span");
        domainBadge.className = "cookie-profile-badge";
        domainBadge.style.color = "var(--accent)";
        domainBadge.textContent = profile.domain;
        badgeGroup.appendChild(domainBadge);
      }

      const countBadge = document.createElement("span");
      countBadge.className = "cookie-profile-badge";
      countBadge.textContent = `${profile.cookieCount || (profile.cookies ? profile.cookies.length : 0)} cookies`;
      badgeGroup.appendChild(countBadge);

      topRow.appendChild(nameEl);
      topRow.appendChild(badgeGroup);

      const metaRow = document.createElement("div");
      metaRow.className = "cookie-profile-meta";
      metaRow.textContent = `Lưu lúc: ${profile.createdAt || "N/A"}`;

      const actionsRow = document.createElement("div");
      actionsRow.className = "cookie-profile-actions";

      // Switch Account button
      const switchBtn = document.createElement("button");
      switchBtn.type = "button";
      switchBtn.className = "cookie-btn-switch";
      switchBtn.innerHTML = `<svg class="icon-small" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><polyline points="17 11 19 13 23 9"></polyline></svg> <span>Chuyển sang phiên này</span>`;
      switchBtn.addEventListener("click", () => {
        applyCookieProfile(profile);
      });

      // Edit Name button
      const editNameBtn = document.createElement("button");
      editNameBtn.type = "button";
      editNameBtn.className = "icon-btn-card";
      editNameBtn.title = "Đổi tên phiên";
      editNameBtn.innerHTML = `<svg class="icon-small" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>`;
      editNameBtn.addEventListener("click", () => {
        const input = document.createElement("input");
        input.type = "text";
        input.className = "inline-name-input";
        input.value = profile.profileName || "";
        input.maxLength = 50;
        input.placeholder = "Nhập tên phiên...";

        let finished = false;
        function finishEditName(save) {
          if (finished) return;
          finished = true;
          if (save) {
            const newName = input.value.trim();
            if (newName && newName !== profile.profileName) {
              profile.profileName = newName;
              saveCookieProfiles();
              showToast(`Đã đổi tên phiên thành "${newName}"!`);
            }
          }
          renderCookieProfilesList();
        }

        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") finishEditName(true);
          else if (e.key === "Escape") finishEditName(false);
        });
        input.addEventListener("blur", () => finishEditName(true));

        topRow.innerHTML = "";
        topRow.appendChild(input);
        topRow.appendChild(badgeGroup);
        input.focus();
        input.select();
      });

      // Export JSON button
      const exportBtn = document.createElement("button");
      exportBtn.type = "button";
      exportBtn.className = "icon-btn-card";
      exportBtn.title = "Sao chép JSON cookies của phiên này";
      exportBtn.innerHTML = `<svg class="icon-small" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
      exportBtn.addEventListener("click", () => {
        const jsonStr = JSON.stringify(profile.cookies, null, 2);
        navigator.clipboard.writeText(jsonStr);
        scheduleClipboardClear(jsonStr);
        showToast(`Đã sao chép ${profile.cookies ? profile.cookies.length : 0} cookies của "${profile.profileName}" ra JSON!`);
      });

      // Delete Profile button
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "icon-btn-card danger";
      deleteBtn.title = "Xóa phiên này";
      deleteBtn.innerHTML = `<svg class="icon-small" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
      deleteBtn.addEventListener("click", () => {
        currentCookieProfiles = currentCookieProfiles.filter(p => p.id !== profile.id);
        saveCookieProfiles();
        renderCookieProfiles();
        showToast(`Đã xóa phiên "${profile.profileName}"!`);
      });

      actionsRow.appendChild(switchBtn);
      actionsRow.appendChild(editNameBtn);
      actionsRow.appendChild(exportBtn);
      actionsRow.appendChild(deleteBtn);

      itemEl.appendChild(topRow);
      itemEl.appendChild(metaRow);
      itemEl.appendChild(actionsRow);

      els.listCookieProfiles.appendChild(itemEl);
    });
  }

  function applyCookieProfile(profile) {
    if (!chrome?.cookies?.set) {
      showToast("Trình duyệt không hỗ trợ cookies API!");
      return;
    }
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const activeTab = tabs?.[0];
      const targetDomain = profile.domain ? profile.domain.replace(/^\./, "") : "";
      const currentTabDomain = activeTab?.url ? extractDomain(activeTab.url) : "";
      const targetUrl = profile.url || (targetDomain ? `https://${targetDomain}` : "https://example.com");

      const cookies = Array.isArray(profile.cookies) ? profile.cookies : [];
      let successCount = 0;
      for (const c of cookies) {
        try {
          const clean = prepareCookieForSet(targetUrl, c);
          await chrome.cookies.set(clean);
          successCount++;
        } catch (e) {
          console.warn("Cookie set error:", e);
        }
      }

      // If already on the same domain, reload it. If on another domain (e.g. on Telegram while switching Facebook), open/navigate!
      if (activeTab?.id) {
        if (currentTabDomain && targetDomain && (currentTabDomain === targetDomain || currentTabDomain.includes(targetDomain) || targetDomain.includes(currentTabDomain))) {
          chrome.tabs.reload(activeTab.id);
        } else if (chrome?.tabs?.create) {
          chrome.tabs.create({ url: targetUrl });
        }
      }
      showToast(`Đã chuyển sang phiên "${profile.profileName}" (${successCount} cookies)!`);
    });
  }

  if (els.btnToggleAddCookieProfile) {
    els.btnToggleAddCookieProfile.addEventListener("click", () => {
      els.cardSaveCookieProfile.hidden = !els.cardSaveCookieProfile.hidden;
      if (!els.cardSaveCookieProfile.hidden) {
        els.cardImportCookies.hidden = true;
        els.inputCookieProfileName.value = "";
        els.inputCookieProfileName.focus();
      }
    });
  }

  if (els.btnCancelSaveCookieProfile) {
    els.btnCancelSaveCookieProfile.addEventListener("click", () => {
      els.cardSaveCookieProfile.hidden = true;
    });
  }

  if (els.btnConfirmSaveCookieProfile) {
    els.btnConfirmSaveCookieProfile.addEventListener("click", () => {
      const profileName = (els.inputCookieProfileName.value || "").trim();
      if (!profileName) {
        showToast("Vui lòng nhập tên phiên / tài khoản!");
        return;
      }

      if (!chrome?.cookies?.getAll) {
        showToast("Trình duyệt không hỗ trợ cookies API!");
        return;
      }

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs?.[0];
        if (!activeTab?.url || activeTab.url.startsWith("chrome://") || activeTab.url.startsWith("edge://")) {
          showToast("Vui lòng mở một trang web thực tế để lưu cookies!");
          return;
        }

        const domain = extractDomain(activeTab.url);
        chrome.cookies.getAll({ url: activeTab.url }, (cookies) => {
          if (!cookies || cookies.length === 0) {
            showToast("Trang web hiện tại không có cookie nào!");
            return;
          }

          const existingIdx = currentCookieProfiles.findIndex(p => p.domain === domain && (p.profileName || "").toLowerCase() === profileName.toLowerCase());
          if (existingIdx !== -1) {
            currentCookieProfiles[existingIdx] = {
              ...currentCookieProfiles[existingIdx],
              cookies,
              cookieCount: cookies.length,
              url: activeTab.url,
              createdAt: new Date().toLocaleTimeString("vi-VN") + " " + new Date().toLocaleDateString("vi-VN")
            };
            showToast(`Đã cập nhật phiên "${profileName}" (${cookies.length} cookies)!`);
          } else {
            const newProfile = {
              id: Date.now().toString(),
              profileName,
              domain,
              url: activeTab.url,
              cookies,
              cookieCount: cookies.length,
              createdAt: new Date().toLocaleTimeString("vi-VN") + " " + new Date().toLocaleDateString("vi-VN")
            };
            currentCookieProfiles.unshift(newProfile);
            showToast(`Đã lưu phiên "${profileName}" (${cookies.length} cookies)!`);
          }

          saveCookieProfiles();
          els.cardSaveCookieProfile.hidden = true;
          els.inputCookieProfileName.value = "";
          renderCookieProfiles();
        });
      });
    });
  }

  if (els.btnToggleImportCookies) {
    els.btnToggleImportCookies.addEventListener("click", () => {
      els.cardImportCookies.hidden = !els.cardImportCookies.hidden;
      if (!els.cardImportCookies.hidden) {
        els.cardSaveCookieProfile.hidden = true;
        els.textareaImportCookiesJson.value = "";
        els.textareaImportCookiesJson.focus();
      }
    });
  }

  if (els.btnCancelImportCookies) {
    els.btnCancelImportCookies.addEventListener("click", () => {
      els.cardImportCookies.hidden = true;
    });
  }

  if (els.btnConfirmImportCookies) {
    els.btnConfirmImportCookies.addEventListener("click", () => {
      const text = els.textareaImportCookiesJson.value.trim();
      if (!text) {
        showToast("Vui lòng dán danh sách JSON cookies!");
        return;
      }

      try {
        const parsed = JSON.parse(text);
        const cookiesList = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.cookies) ? parsed.cookies : null);
        if (!cookiesList || cookiesList.length === 0) {
          showToast("JSON cookies không hợp lệ!");
          return;
        }

        chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
          const activeTab = tabs?.[0];
          const domain = activeTab?.url ? extractDomain(activeTab.url) : "imported";
          const newProfile = {
            id: Date.now().toString(),
            profileName: `Nhập JSON (${cookiesList.length} cookies)`,
            domain,
            url: activeTab?.url || "",
            cookies: cookiesList,
            cookieCount: cookiesList.length,
            createdAt: new Date().toLocaleTimeString("vi-VN") + " " + new Date().toLocaleDateString("vi-VN")
          };

          currentCookieProfiles.unshift(newProfile);
          saveCookieProfiles();

          if (activeTab?.url && chrome?.cookies?.set) {
            let successCount = 0;
            for (const c of cookiesList) {
              try {
                const clean = prepareCookieForSet(activeTab.url, c);
                await chrome.cookies.set(clean);
                successCount++;
              } catch (e) {
                console.warn("Cookie set error:", e);
              }
            }
            if (chrome?.tabs?.reload && activeTab.id) {
              chrome.tabs.reload(activeTab.id);
            }
            showToast(`Đã nhập & áp dụng ${successCount} cookies vào trang!`);
          } else {
            showToast(`Đã lưu hồ sơ ${cookiesList.length} cookies!`);
          }

          els.cardImportCookies.hidden = true;
          els.textareaImportCookiesJson.value = "";
          renderCookieProfiles();
        });
      } catch (err) {
        showToast("Lỗi định dạng JSON: " + err.message);
      }
    });
  }

  if (els.btnExportCurrentCookies) {
    els.btnExportCurrentCookies.addEventListener("click", () => {
      if (!chrome?.cookies?.getAll) {
        showToast("Trình duyệt không hỗ trợ cookies API!");
        return;
      }
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs?.[0];
        if (!activeTab?.url || activeTab.url.startsWith("chrome://") || activeTab.url.startsWith("edge://")) {
          showToast("Vui lòng mở một trang web thực tế để xuất cookies!");
          return;
        }
        chrome.cookies.getAll({ url: activeTab.url }, (cookies) => {
          if (!cookies || cookies.length === 0) {
            showToast("Trang web hiện tại không có cookie nào để xuất!");
            return;
          }
          const jsonStr = JSON.stringify(cookies, null, 2);
          navigator.clipboard.writeText(jsonStr);
          scheduleClipboardClear(jsonStr);
          showToast(`Đã xuất & sao chép ${cookies.length} cookies ra JSON!`);
        });
      });
    });
  }

  if (els.btnClearDomainCookies) {
    els.btnClearDomainCookies.addEventListener("click", () => {
      if (!chrome?.cookies?.getAll || !chrome?.cookies?.remove) {
        showToast("Trình duyệt không hỗ trợ cookies API!");
        return;
      }
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs?.[0];
        if (!activeTab?.url || activeTab.url.startsWith("chrome://") || activeTab.url.startsWith("edge://")) {
          showToast("Vui lòng mở một trang web thực tế!");
          return;
        }
        chrome.cookies.getAll({ url: activeTab.url }, async (cookies) => {
          if (!cookies || cookies.length === 0) {
            showToast("Trang hiện tại không có cookie nào!");
            return;
          }
          for (const c of cookies) {
            const protocol = c.secure ? "https:" : "http:";
            const cleanDomain = c.domain ? c.domain.replace(/^\./, "") : extractDomain(activeTab.url);
            const cookieUrl = `${protocol}//${cleanDomain}${c.path || "/"}`;
            try {
              await chrome.cookies.remove({ url: cookieUrl, name: c.name });
            } catch (e) {
              console.warn("Cookie remove error:", e);
            }
          }
          if (chrome?.tabs?.reload && activeTab.id) {
            chrome.tabs.reload(activeTab.id);
          }
          showToast(`Đã xóa ${cookies.length} cookies của trang & đăng xuất!`);
        });
      });
    });
  }

  if (els.inputSearchCookies) {
    els.inputSearchCookies.addEventListener("input", (e) => {
      currentCookiesSearchQuery = e.target.value.trim().toLowerCase();
      if (els.btnClearCookiesSearch) {
        els.btnClearCookiesSearch.hidden = !currentCookiesSearchQuery;
      }
      renderCookieProfiles();
    });
  }

  if (els.btnClearCookiesSearch) {
    els.btnClearCookiesSearch.addEventListener("click", () => {
      els.inputSearchCookies.value = "";
      currentCookiesSearchQuery = "";
      els.btnClearCookiesSearch.hidden = true;
      renderCookieProfiles();
    });
  }

  // Prevent browser from navigating away on dropped files outside drop targets
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());

  // Auto-sync storage changes between tab and popup
  if (chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local") {
        // Kho dang bat: chi theo doi blob giai mai, khong doc khoa thang
        if (vaultOn && vaultKey) {
          if (!changes.genVault) return;
          GPVault.decryptBlob(changes.genVault.newValue, vaultKey)
            .then(data => {
              if (Array.isArray(data.genTags) && data.genTags.length > 0) {
                currentTags = data.genTags;
                vaultData.genTags = data.genTags;
              }
              if (Array.isArray(data.genHistory)) {
                currentHistory = data.genHistory;
                vaultData.genHistory = data.genHistory;
              }
              if (Array.isArray(data.gen2FA)) {
                current2FA = data.gen2FA;
                vaultData.gen2FA = data.gen2FA;
              }
              if (Array.isArray(data.genCards)) {
                currentCards = data.genCards;
                vaultData.genCards = data.genCards;
              }
              if (Array.isArray(data.genCookieProfiles)) {
                currentCookieProfiles = data.genCookieProfiles;
                vaultData.genCookieProfiles = data.genCookieProfiles;
              }
              renderTags();
              updateHistoryUI();
              render2FA();
              renderCards();
              renderCookieProfiles();
            })
            .catch(() => {
              // blob khac khoa (doi PIN o dau do): bo qua
            });
          return;
        }
        if (changes.genHistory) {
          currentHistory = Array.isArray(changes.genHistory.newValue) ? changes.genHistory.newValue : [];
          updateHistoryUI();
          renderTagFilterBar();
        }
        if (changes.genCards) {
          currentCards = Array.isArray(changes.genCards.newValue) ? changes.genCards.newValue : [];
          renderCards();
        }
        if (changes.genCookieProfiles) {
          currentCookieProfiles = Array.isArray(changes.genCookieProfiles.newValue) ? changes.genCookieProfiles.newValue : [];
          renderCookieProfiles();
        }
      }
    });
  }

  // Init
  loadOptions(() => {
    handleGenerate(false);
    detectActiveTab();

    // Check URL parameters (e.g. when opened in a separate browser tab)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("tab") === "history" || urlParams.get("view") === "history") {
      switchTab(els.tabHistory, els.viewHistory);
      if (urlParams.get("open") === "import") {
        openImportModal();
      }
    } else if (urlParams.get("tab") === "2fa" || urlParams.get("view") === "2fa") {
      switchTab(els.tab2Fa, els.view2Fa);
    } else if (urlParams.get("tab") === "cards" || urlParams.get("view") === "cards") {
      switchTab(els.tabCards, els.viewCards);
    } else if (urlParams.get("tab") === "cookies" || urlParams.get("view") === "cookies") {
      switchTab(els.tabCookies, els.viewCookies);
    }
  });
});
