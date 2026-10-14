// GenPass Background Service Worker - Hierarchical Context Menus & Security Engine
try {
  importScripts("vendor/hash-wasm.umd.js"); // Argon2id wasm phai nap truoc vault.js
} catch (e) {
  console.warn("Failed to import hash-wasm:", e);
}

try {
  importScripts("vault.js");
} catch (e) {
  console.warn("Failed to import vault.js:", e);
}

try {
  importScripts("jsqr.js");
} catch (e) {
  console.warn("Failed to import jsqr.js:", e);
}

try {
  importScripts("wordlist.js");
} catch (e) {
  console.warn("Failed to import wordlist.js:", e);
}

// Mac dinh session chi danh cho trusted contexts (popup/SW); dat tuong minh de content script khong doc duoc
try {
  if (chrome.storage && chrome.storage.session && chrome.storage.session.setAccessLevel) {
    const r = chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
    if (r && typeof r.catch === "function") r.catch(() => {});
  }
} catch (e) { /* bo qua: API cu chi ho tro callback */ }

// 1. Setup Hierarchical Context Menus (Ho tro song ngu VI / EN)
function setupContextMenus(lang) {
  const isEn = lang === "en";
  if (!chrome.contextMenus || !chrome.contextMenus.removeAll) return;
  chrome.contextMenus.removeAll(() => {
    if (chrome.runtime?.lastError) {}

    // Root Menu
    chrome.contextMenus.create({
      id: "genpass_root",
      title: "GenPass",
      contexts: ["all"]
    });

    // Submenu 1: Tạo mật khẩu / Generate Password
    chrome.contextMenus.create({
      id: "genpass_menu_generate",
      parentId: "genpass_root",
      title: isEn ? "Generate password" : "Tạo mật khẩu",
      contexts: ["all"]
    });

    chrome.contextMenus.create({
      id: "gen_std_16",
      parentId: "genpass_menu_generate",
      title: isEn ? "Standard password (16 chars)" : "Mật khẩu chuẩn (16 ký tự)",
      contexts: ["all"]
    });

    chrome.contextMenus.create({
      id: "gen_passphrase_4",
      parentId: "genpass_menu_generate",
      title: isEn ? "Passphrase (4 words)" : "Cụm từ dễ nhớ (Passphrase 4 từ)",
      contexts: ["all"]
    });

    chrome.contextMenus.create({
      id: "gen_long_32",
      parentId: "genpass_menu_generate",
      title: isEn ? "Long password (32 chars)" : "Mật khẩu siêu dài (32 ký tự)",
      contexts: ["all"]
    });

    chrome.contextMenus.create({
      id: "gen_alphanum_12",
      parentId: "genpass_menu_generate",
      title: isEn ? "Alphanumeric (12 chars - for banks)" : "Chữ & số (12 ký tự - cho ngân hàng)",
      contexts: ["all"]
    });

    chrome.contextMenus.create({
      id: "gen_pin_6",
      parentId: "genpass_menu_generate",
      title: isEn ? "PIN (6 digits)" : "Mã PIN số (6 số)",
      contexts: ["all"]
    });

    // Submenu 2: Quét mã QR 2FA / Scan 2FA QR
    chrome.contextMenus.create({
      id: "genpass_menu_qr",
      parentId: "genpass_root",
      title: isEn ? "Scan 2FA QR code" : "Quét mã QR 2FA",
      contexts: ["all"]
    });

    chrome.contextMenus.create({
      id: "qr_scan_image",
      parentId: "genpass_menu_qr",
      title: isEn ? "Scan from this image" : "Quét từ ảnh này",
      contexts: ["image"]
    });

    chrome.contextMenus.create({
      id: "qr_scan_screen",
      parentId: "genpass_menu_qr",
      title: isEn ? "Scan entire page" : "Quét toàn bộ trang web này",
      contexts: ["all"]
    });

    // Submenu 3: Tự động điền / Autofill
    chrome.contextMenus.create({
      id: "genpass_menu_fill",
      parentId: "genpass_root",
      title: isEn ? "Autofill" : "Tự động điền",
      contexts: ["all"]
    });

    chrome.contextMenus.create({
      id: "fill_saved_creds",
      parentId: "genpass_menu_fill",
      title: isEn ? "Fill saved account (by site)" : "Điền tài khoản đã lưu (theo trang)",
      contexts: ["all"]
    });

    chrome.contextMenus.create({
      id: "fill_latest_2fa",
      parentId: "genpass_menu_fill",
      title: isEn ? "Fill latest 2FA OTP code" : "Điền mã OTP 2FA mới nhất",
      contexts: ["all"]
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get("genOptions", (res) => {
    setupContextMenus(res?.genOptions?.lang || "vi");
  });
});

if (chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.genOptions) {
      const oldLang = changes.genOptions.oldValue?.lang;
      const newLang = changes.genOptions.newValue?.lang;
      if (newLang && newLang !== oldLang) {
        setupContextMenus(newLang);
      }
    }
  });
}

// Helper: Secure Random Numbers
function secureRandomInt(max) {
  if (max <= 0) return 0;
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  do {
    crypto.getRandomValues(buf);
  } while (buf[0] >= limit);
  return buf[0] % max;
}

// Password Generator Options
function generatePasswordFromPool(len, chars) {
  let pwd = "";
  for (let i = 0; i < len; i++) {
    pwd += chars[secureRandomInt(chars.length)];
  }
  return pwd;
}

function generatePassphraseWords(count = 4, separator = "-") {
  const list = (typeof DICEWARE_WORDS !== "undefined" && Array.isArray(DICEWARE_WORDS) && DICEWARE_WORDS.length > 0)
    ? DICEWARE_WORDS
    : ["apple", "river", "vintage", "rocket", "amber", "forest", "galaxy"];
  const words = [];
  for (let i = 0; i < count; i++) {
    const word = list[secureRandomInt(list.length)];
    words.push(word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
  }
  return words.join(separator);
}

// Helper: Base32 Decoder for TOTP
function base32Decode(str) {
  if (!str) return new Uint8Array(0);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = str.toUpperCase().replace(/[\s=]/g, "");
  let bits = 0;
  let value = 0;
  const output = [];

  for (let i = 0; i < clean.length; i++) {
    const idx = alphabet.indexOf(clean[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(output);
}

// Helper: Compute current RFC 6238 TOTP Code
async function computeTotpCode(secretKey, opts = {}) {
  const keyBytes = base32Decode(secretKey);
  if (keyBytes.length === 0) return "";
  const period = parseInt(opts.period, 10) || 30;
  const digits = parseInt(opts.digits, 10) || 6;
  const rawAlgo = (opts.algorithm || "SHA-1").toUpperCase();
  const hash = ["SHA-1", "SHA-256", "SHA-512"].includes(rawAlgo) ? rawAlgo : "SHA-1";

  const counter = Math.floor(Date.now() / 1000 / period);
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setBigUint64(0, BigInt(counter), false);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, buffer);
  const sigBytes = new Uint8Array(sig);
  const offset = sigBytes[sigBytes.length - 1] & 0x0f;
  const binary =
    ((sigBytes[offset] & 0x7f) << 24) |
    ((sigBytes[offset + 1] & 0xff) << 16) |
    ((sigBytes[offset + 2] & 0xff) << 8) |
    (sigBytes[offset + 3] & 0xff);
  const mod = Math.pow(10, digits);
  return (binary % mod).toString().padStart(digits, "0");
}

// Helper: Parse otpauth:// URL
function parseOtpAuthUrl(urlStr) {
  try {
    const url = new URL(urlStr);
    if (url.protocol !== "otpauth:") return null;
    let label = decodeURIComponent(url.pathname.replace(/^\/\/?/, ""));
    let issuer = url.searchParams.get("issuer") || "";
    let account = "";
    const pathParts = label.split(":");
    if (pathParts.length > 1) {
      issuer = issuer || pathParts[0];
      account = pathParts[1];
    } else {
      account = pathParts[0] || "";
    }
    const secret = url.searchParams.get("secret") || "";
    const algorithm = (url.searchParams.get("algorithm") || "SHA-1").toUpperCase();
    const digits = parseInt(url.searchParams.get("digits"), 10) || 6;
    const period = parseInt(url.searchParams.get("period"), 10) || 30;
    return {
      name: issuer || account || "2FA",
      account: account,
      secret: secret.trim(),
      algorithm,
      digits,
      period
    };
  } catch {
    return null;
  }
}

// Chặn SSRF: Chỉ cho phép fetch các URL an toàn (data:, blob:, hoặc domain công khai)
// Chặn tuyệt đối localhost, 127.0.0.1, dải IP private LAN (10.*, 192.168.*, 172.16-31.*), link-local 169.254.*
function isSafeFetchUrl(urlStr) {
  if (!urlStr || typeof urlStr !== "string") return false;
  const s = urlStr.trim();
  if (s.startsWith("data:") || s.startsWith("blob:")) return true;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    let host = u.hostname.toLowerCase();
    if (host.startsWith("[") && host.endsWith("]")) {
      host = host.slice(1, -1);
    }
    if (
      host === "localhost" ||
      host === "0.0.0.0" ||
      host === "::" ||
      host.endsWith(".local") ||
      host.endsWith(".localhost") ||
      host.endsWith(".internal")
    ) {
      return false;
    }
    // Chặn IPv6-mapped IPv4 ([::ffff:127.0.0.1], ::ffff:7f00:1)
    if (host.startsWith("::ffff:") || host.startsWith("ffff:")) return false;
    if (/^127\./.test(host)) return false;
    if (/^10\./.test(host)) return false;
    if (/^192\.168\./.test(host)) return false;
    if (/^169\.254\./.test(host)) return false;
    if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)) return false;
    if (host === "::1" || host === "0:0:0:0:0:0:0:1" || host === "0:0:0:0:0:0:0:0") return false;
    if (host.startsWith("fe80:") || host.startsWith("fc00:") || host.startsWith("fd00:")) return false;
    return true;
  } catch {
    return false;
  }
}

// Helper: Decode QR code from Image URL or Data URI using OffscreenCanvas
async function decodeQrFromUrl(url) {
  if (!isSafeFetchUrl(url)) return null;
  try {
    const response = await fetch(url, { redirect: "error" });
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);

    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(bitmap, 0, 0);
    const imgData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);

    if (typeof jsQR === "function") {
      const code = jsQR(imgData.data, bitmap.width, bitmap.height, { inversionAttempts: "attemptBoth" });
      if (code && code.data) return code.data;

      // Downscale if image is high-res (>1500px)
      if (bitmap.width > 1500 || bitmap.height > 1500) {
        const w = Math.round(bitmap.width * 0.5);
        const h = Math.round(bitmap.height * 0.5);
        const canvasSmall = new OffscreenCanvas(w, h);
        const ctxSmall = canvasSmall.getContext("2d");
        ctxSmall.drawImage(bitmap, 0, 0, w, h);
        const smallData = ctxSmall.getImageData(0, 0, w, h);
        const codeSmall = jsQR(smallData.data, w, h, { inversionAttempts: "attemptBoth" });
        if (codeSmall && codeSmall.data) return codeSmall.data;
      }
    }
  } catch (err) {
    console.warn("Background QR decode error:", err);
  }
  return null;
}

// --- Vault helpers: doc/ghi 6 khoa nhay cam qua blob AES-GCM ---
const VAULT_KEYS = ["genHistory", "gen2FA", "genCards", "genCookieProfiles", "genTags", "genSnippets"];

function vaultReady() {
  return typeof GPVault !== "undefined" && !!GPVault.encryptWithPin;
}

// { vault, key, data, locked, plain }
async function vaultContext() {
  const plain = await chrome.storage.local.get(["genVault"].concat(VAULT_KEYS, ["genOptions"]));
  const ctx = { plain: plain, vault: null, key: null, data: null, locked: false };
  if (!plain.genVault || !vaultReady() || plain.genOptions?.vaultEnabled !== true) return ctx;

  ctx.vault = plain.genVault;
  const sess = await chrome.storage.session.get("genVaultKey");
  const entry = sess.genVaultKey;
  if (!entry) {
    ctx.locked = true;
    return ctx;
  }
  // Envelope moi { k: keyB64, exp }; van chua dang bare string cua ban cu
  const keyB64 = typeof entry === "string" ? entry : entry && entry.k;
  // key phiên het han -> xoa va bat nhap lai ma bao ve
  if (entry && entry.exp && Date.now() > entry.exp) {
    await chrome.storage.session.remove("genVaultKey");
    ctx.locked = true;
    return ctx;
  }
  try {
    // decryptBlob nhan thang chuoi b64, khong con importKey
    ctx.key = keyB64;
    ctx.data = await GPVault.decryptBlob(plain.genVault, keyB64);
  } catch (err) {
    console.warn("Kho khong giai mai duoc (doi PIN?):", err);
    ctx.locked = true;
  }
  return ctx;
}

// Vault bat: giai mai + luu lai blob. Vault tat: ghi thang khoa nhu cu
async function vaultMutate(partial) {
  const ctx = await vaultContext();
  if (!ctx.vault) {
    await chrome.storage.local.set(partial);
    return;
  }
  if (ctx.locked || !ctx.key || !ctx.data) throw new Error("VAULT_LOCKED");
  Object.assign(ctx.data, partial);
  // Ma hoa lai, giu nguyen salt/tham so KDF cua blob cu qua reencrypt
  const blob = await GPVault.reencrypt(ctx.data, ctx.key, {
    salt: ctx.vault.salt,
    t: ctx.vault.t,
    m: ctx.vault.m,
    p: ctx.vault.p
  });
  await chrome.storage.local.set({ genVault: blob });
}

// Doc cac khoa can thiet: khoa vault lay tu blob, khoa con lai lay thang storage
async function vaultRead(keys, tabUrl = null) {
  const list = Array.isArray(keys) ? keys : [];
  const ctx = await vaultContext();
  if (ctx.locked) return { __locked: true };
  const out = {};
  list.forEach(k => {
    let val;
    if (ctx.vault && ctx.data && Object.prototype.hasOwnProperty.call(ctx.data, k)) val = ctx.data[k];
    else if (Object.prototype.hasOwnProperty.call(ctx.plain, k)) val = ctx.plain[k];

    // Neu la content script tren tab web yeu cau genHistory, chi tra ve account khop origin cua tab
    if (tabUrl && k === "genHistory" && Array.isArray(val)) {
      try {
        const domain = new URL(tabUrl).hostname.replace(/^www\./i, "").toLowerCase();
        val = val.filter(h => {
          if (h.url) {
            try { return new URL(h.url).hostname.replace(/^www\./i, "").toLowerCase() === domain; } catch { return false; }
          }
          return h.name && h.name.replace(/^www\./i, "").toLowerCase() === domain;
        });
      } catch {
        val = [];
      }
    }
    // Content script khong duoc phep truy xuat genCards hoac genCookieProfiles cua trang khac
    if (tabUrl && (k === "genCards" || k === "genCookieProfiles")) {
      val = [];
    }
    out[k] = val;
  });
  return out;
}

// Helper: Save 2FA with Deduplication Guard
async function save2FaCredential(name, account, secret, tabId, opts = {}) {
  const res = await vaultRead(["gen2FA"]);
  if (res.__locked) {
    console.error("GenPass: kho dang khoa, mo popup va nhap PIN de luu ma 2FA");
    chrome.tabs.sendMessage(tabId, {
      action: "show_toast",
      message: "GenPass: Kho đang khóa, mở popup và nhập PIN để lưu mã 2FA!"
    });
    return;
  }
  const list = Array.isArray(res.gen2FA) ? res.gen2FA : [];
  const cleanSecret = secret.trim().replace(/\s+/g, "").toUpperCase();
  const existingIndex = list.findIndex(item => item.secret && item.secret.toUpperCase() === cleanSecret);

  const newItem = {
    id: existingIndex >= 0 ? list[existingIndex].id : Date.now().toString(),
    name: name || (existingIndex >= 0 ? list[existingIndex].name : "2FA Account"),
    account: account || (existingIndex >= 0 ? list[existingIndex].account : ""),
    secret: cleanSecret,
    algorithm: opts.algorithm || "SHA-1",
    digits: opts.digits || 6,
    period: opts.period || 30,
    createdAt: new Date().toLocaleTimeString("vi-VN")
  };

  if (existingIndex >= 0) {
    list[existingIndex] = newItem;
  } else {
    list.unshift(newItem);
  }

  await vaultMutate({ gen2FA: list });
  chrome.tabs.sendMessage(tabId, {
    action: "show_toast",
    message: existingIndex >= 0
      ? `GenPass: Đã cập nhật mã 2FA "${newItem.name}"!`
      : `GenPass: Đã lưu mã 2FA "${newItem.name}"!`
  });
}

// 2. Handle Context Menu Clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  const POOLS = {
    std: "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*()-_=+",
    alphanum: "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789",
    pin: "0123456789"
  };

  // Group 1: Password Generation options
  let generatedPwd = null;
  let genLabel = "mật khẩu";

  switch (info.menuItemId) {
    case "gen_std_16":
      generatedPwd = generatePasswordFromPool(16, POOLS.std);
      genLabel = "mật khẩu chuẩn (16 ký tự)";
      break;
    case "gen_passphrase_4":
      generatedPwd = generatePassphraseWords(4, "-");
      genLabel = "cụm từ mật khẩu (Passphrase 4 từ)";
      break;
    case "gen_long_32":
      generatedPwd = generatePasswordFromPool(32, POOLS.std);
      genLabel = "mật khẩu dài (32 ký tự)";
      break;
    case "gen_alphanum_12":
      generatedPwd = generatePasswordFromPool(12, POOLS.alphanum);
      genLabel = "mật khẩu chữ & số (12 ký tự)";
      break;
    case "gen_pin_6":
      generatedPwd = generatePasswordFromPool(6, POOLS.pin);
      genLabel = "mã PIN (6 số)";
      break;
  }

  if (generatedPwd) {
    chrome.tabs.sendMessage(tab.id, {
      action: "fill_generated_password",
      password: generatedPwd,
      label: genLabel
    });
    return;
  }

  // Group 2: QR Scanning
  if (info.menuItemId === "qr_scan_image" && info.srcUrl) {
    chrome.tabs.sendMessage(tab.id, {
      action: "show_toast",
      message: "GenPass: Đang quét mã QR từ ảnh..."
    });

    let qrText = await decodeQrFromUrl(info.srcUrl);

    // Fallback: check content script DOM
    if (!qrText) {
      try {
        const contentRes = await chrome.tabs.sendMessage(tab.id, {
          action: "decode_image_element",
          srcUrl: info.srcUrl
        });
        if (contentRes?.qrText) qrText = contentRes.qrText;
      } catch (err) {
        console.warn("DOM image decode fallback failed:", err);
      }
    }

    if (!qrText) {
      chrome.tabs.sendMessage(tab.id, {
        action: "show_toast",
        message: "GenPass: Không tìm thấy mã QR nào trong ảnh này!"
      });
      return;
    }

    processQrResult(qrText, tab.id);
    return;
  }

  if (info.menuItemId === "qr_scan_screen") {
    chrome.tabs.sendMessage(tab.id, {
      action: "show_toast",
      message: "GenPass: Đang quét mã QR toàn trang..."
    });

    chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }, async (dataUrl) => {
      if (chrome.runtime.lastError || !dataUrl) {
        chrome.tabs.sendMessage(tab.id, {
          action: "show_toast",
          message: "GenPass: Không thể chụp màn hình trang web!"
        });
        return;
      }

      let qrText = await decodeQrFromUrl(dataUrl);

      // Fallback: check DOM candidate images if screenshot doesn't yield QR
      if (!qrText) {
        try {
          const domRes = await chrome.tabs.sendMessage(tab.id, { action: "find_page_qr_candidates" });
          if (domRes?.otpUrl) {
            qrText = domRes.otpUrl;
          } else if (Array.isArray(domRes?.candidates)) {
            for (const candSrc of domRes.candidates) {
              const res = await decodeQrFromUrl(candSrc);
              if (res) {
                qrText = res;
                break;
              }
            }
          }
        } catch (err) {
          console.warn("DOM candidate QR search failed:", err);
        }
      }

      if (!qrText) {
        chrome.tabs.sendMessage(tab.id, {
          action: "show_toast",
          message: "GenPass: Không tìm thấy mã QR trên trang này!"
        });
        return;
      }

      processQrResult(qrText, tab.id);
    });
    return;
  }

  // Group 3: Auto-Fill
  if (info.menuItemId === "fill_saved_creds") {
    chrome.tabs.sendMessage(tab.id, { action: "trigger_autofill_creds" });
    return;
  }

  if (info.menuItemId === "fill_latest_2fa") {
    // Khong co quyen notifications trong manifest, gioi han o console.error khien kho bi khoa
    const gpRes = await vaultRead(["gen2FA"]);
    if (gpRes.__locked) {
      console.error("GenPass: kho dang khoa, mo popup va nhap PIN de dien ma 2FA");
      chrome.tabs.sendMessage(tab.id, {
        action: "show_toast",
        message: "GenPass: Kho đang khóa, mở popup và nhập PIN để điền mã 2FA!"
      });
      return;
    }
    const list = Array.isArray(gpRes.gen2FA) ? gpRes.gen2FA : [];
    if (list.length === 0) {
      chrome.tabs.sendMessage(tab.id, {
        action: "show_toast",
        message: "GenPass: Bạn chưa lưu mã 2FA nào!"
      });
      return;
    }

    // Find matching item for domain or use first item
    let targetItem = list[0];
    if (tab.url) {
      try {
        const domain = new URL(tab.url).hostname.replace(/^www\./i, "").toLowerCase();
        const match = list.find(item => {
          if (!item.name) return false;
          const itemName = item.name.replace(/^www\./i, "").toLowerCase();
          return itemName === domain || domain.endsWith("." + itemName);
        });
        if (match) targetItem = match;
      } catch (err) {
        console.warn("Domain matching for 2FA failed:", err);
      }
    }

    const otp = await computeTotpCode(targetItem.secret, targetItem);
    if (!otp) {
      chrome.tabs.sendMessage(tab.id, {
        action: "show_toast",
        message: "GenPass: Khóa bí mật 2FA không hợp lệ!"
      });
      return;
    }

    chrome.tabs.sendMessage(tab.id, {
      action: "fill_2fa",
      code: otp,
      accountName: targetItem.name
    });
  }
});

function processQrResult(qrText, tabId) {
  const trimmed = qrText.trim();
  let name = "2FA Account";
  let account = "";
  let secret = "";
  let otpOpts = {};

  if (trimmed.startsWith("otpauth://")) {
    const parsed = parseOtpAuthUrl(trimmed);
    if (parsed && parsed.secret) {
      name = parsed.name;
      account = parsed.account;
      secret = parsed.secret;
      otpOpts = {
        algorithm: parsed.algorithm,
        digits: parsed.digits,
        period: parsed.period
      };
    }
  } else {
    const cleanKey = trimmed.replace(/\s+/g, "").toUpperCase();
    if (/^[A-Z2-7=]{8,}$/.test(cleanKey)) {
      secret = cleanKey;
    }
  }

  if (!secret) {
    chrome.tabs.sendMessage(tabId, {
      action: "show_toast",
      message: "GenPass: Mã QR không chứa thông tin 2FA hợp lệ!"
    });
    return;
  }

  save2FaCredential(name, account, secret, tabId, otpOpts).catch(err => {
    console.error("Lưu 2FA thất bại:", err);
  });
}

// 3. Auto-Update Version Checker (GitHub Raw API)
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

async function checkForUpdates() {
  try {
    const res = await fetch("https://raw.githubusercontent.com/lengoctuong2005/GenPass/main/manifest.json?t=" + Date.now(), {
      cache: "no-store"
    });
    if (!res.ok) return;
    const remote = await res.json();
    const localVersion = chrome.runtime.getManifest().version;
    if (remote?.version) {
      const hasUpdate = compareVersions(remote.version, localVersion) > 0;
      if (hasUpdate) {
        chrome.action.setBadgeText({ text: "NEW" });
        chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
        chrome.storage.local.set({
          genUpdateInfo: {
            hasUpdate: true,
            remoteVersion: remote.version,
            localVersion: localVersion,
            checkedAt: Date.now()
          }
        });
      } else {
        chrome.action.setBadgeText({ text: "" });
        chrome.storage.local.set({
          genUpdateInfo: {
            hasUpdate: false,
            remoteVersion: remote.version,
            localVersion: localVersion,
            checkedAt: Date.now()
          }
        });
      }
    }
  } catch (err) {
    console.warn("Auto-update check error:", err);
  }
}

chrome.runtime.onStartup.addListener(checkForUpdates);
if (chrome.alarms) {
  chrome.alarms.create("check_update_alarm", { periodInMinutes: 720 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "check_update_alarm") checkForUpdates();
  });
}

// Tu khoa khi dong popup: task bat dong bo cua popup bi huy khi trinh trinh popup bi dung,
// nhung su kien tat cong ket noi cua SW thi khong. Popup mo cong "vault-session" khi hoat dong.
// Dem so cong dang mo va chi thu hoi khoa phien khi cong cuoi cung dong, neu khong
// viec dong mot popup se khoa nham nhung popup / side panel dang con hoat dong.
let vaultPortCount = 0;
chrome.runtime.onConnect.addListener((port) => {
  if (!port || port.name !== "vault-session") return;
  // Chi chap nhan port tu popup / trang extension, chan content script pin port
  if (port.sender?.url && !port.sender.url.startsWith("chrome-extension://")) return;
  vaultPortCount++;
  port.onDisconnect.addListener(async () => {
    vaultPortCount = Math.max(0, vaultPortCount - 1);
    // Chi thu hoi khoa phien khi popup cuoi cung dong, tranh dong nham giua nhieu popup
    if (vaultPortCount > 0) return;
    try {
      const { genOptions } = await chrome.storage.local.get("genOptions");
      if (genOptions && genOptions.vaultLockClose) {
        await chrome.storage.session.remove("genVaultKey");
      }
    } catch (e) { /* bo qua: popup da dong */ }
  });
});

// Cau hoi tu popup va content script ve trang thai / du lieu kho
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.action) return;

  const isWebPage = !!(sender?.url && !sender.url.startsWith("chrome-extension://"));

  if (msg.action === "vault_lock") {
    // Chan web content script khoa kho trai phep gay DoS
    if (isWebPage) {
      sendResponse({ ok: false, error: "UNAUTHORIZED" });
      return;
    }
    chrome.storage.session.remove("genVaultKey");
    sendResponse({ ok: true });
    return;
  }

  if (msg.action === "vault_state") {
    vaultContext().then(ctx => {
      sendResponse({ enabled: ctx.vault != null, locked: !!ctx.locked });
    });
    return true;
  }

  if (msg.action === "vault_get") {
    // Neu la content script tren tab web, chi tra ve data khop origin tab do
    vaultRead(msg.keys, isWebPage ? sender.url : null).then(sendResponse);
    return true;
  }

  if (msg.action === "vault_put") {
    vaultMutate(msg.items || {}).then(
      () => sendResponse({ ok: true }),
      err => {
        console.error("vault_put thất bại:", err);
        sendResponse({ ok: false, locked: String(err && err.message) === "VAULT_LOCKED" });
      }
    );
    return true;
  }
});

// Initial check on worker load
checkForUpdates();
