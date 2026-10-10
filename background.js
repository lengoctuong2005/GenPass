// GenPass Background Service Worker - Hierarchical Context Menus & Security Engine
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

// 1. Setup Hierarchical Context Menus
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    // Root Menu
    chrome.contextMenus.create({
      id: "genpass_root",
      title: "GenPass",
      contexts: ["all"]
    });

    // Submenu 1: Tạo mật khẩu
    chrome.contextMenus.create({
      id: "genpass_menu_generate",
      parentId: "genpass_root",
      title: "Tạo mật khẩu",
      contexts: ["all"]
    });

    chrome.contextMenus.create({
      id: "gen_std_16",
      parentId: "genpass_menu_generate",
      title: "Mật khẩu chuẩn (16 ký tự)",
      contexts: ["all"]
    });

    chrome.contextMenus.create({
      id: "gen_passphrase_4",
      parentId: "genpass_menu_generate",
      title: "Cụm từ dễ nhớ (Passphrase 4 từ)",
      contexts: ["all"]
    });

    chrome.contextMenus.create({
      id: "gen_long_32",
      parentId: "genpass_menu_generate",
      title: "Mật khẩu siêu dài (32 ký tự)",
      contexts: ["all"]
    });

    chrome.contextMenus.create({
      id: "gen_alphanum_12",
      parentId: "genpass_menu_generate",
      title: "Chữ & số (12 ký tự - cho ngân hàng)",
      contexts: ["all"]
    });

    chrome.contextMenus.create({
      id: "gen_pin_6",
      parentId: "genpass_menu_generate",
      title: "Mã PIN số (6 số)",
      contexts: ["all"]
    });

    // Submenu 2: Quét mã QR 2FA
    chrome.contextMenus.create({
      id: "genpass_menu_qr",
      parentId: "genpass_root",
      title: "Quét mã QR 2FA",
      contexts: ["all"]
    });

    chrome.contextMenus.create({
      id: "qr_scan_image",
      parentId: "genpass_menu_qr",
      title: "Quét từ ảnh này",
      contexts: ["image"]
    });

    chrome.contextMenus.create({
      id: "qr_scan_screen",
      parentId: "genpass_menu_qr",
      title: "Quét toàn bộ trang web này",
      contexts: ["all"]
    });

    // Submenu 3: Tự động điền
    chrome.contextMenus.create({
      id: "genpass_menu_fill",
      parentId: "genpass_root",
      title: "Tự động điền",
      contexts: ["all"]
    });

    chrome.contextMenus.create({
      id: "fill_saved_creds",
      parentId: "genpass_menu_fill",
      title: "Điền tài khoản đã lưu (theo trang)",
      contexts: ["all"]
    });

    chrome.contextMenus.create({
      id: "fill_latest_2fa",
      parentId: "genpass_menu_fill",
      title: "Điền mã OTP 2FA mới nhất",
      contexts: ["all"]
    });
  });
});

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
async function computeTotpCode(secretKey) {
  const keyBytes = base32Decode(secretKey);
  if (keyBytes.length === 0) return "";
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setBigUint64(0, BigInt(counter), false);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-1" },
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
  return (binary % 1000000).toString().padStart(6, "0");
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
    return {
      name: issuer || account || "2FA",
      account: account,
      secret: secret.trim()
    };
  } catch {
    return null;
  }
}

// Helper: Decode QR code from Image URL or Data URI using OffscreenCanvas
async function decodeQrFromUrl(url) {
  try {
    const response = await fetch(url);
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

// Helper: Save 2FA with Deduplication Guard
function save2FaCredential(name, account, secret, tabId) {
  chrome.storage.local.get(["gen2FA"], (res) => {
    const list = Array.isArray(res.gen2FA) ? res.gen2FA : [];
    const cleanSecret = secret.trim().replace(/\s+/g, "").toUpperCase();
    const existingIndex = list.findIndex(item => item.secret && item.secret.toUpperCase() === cleanSecret);

    const newItem = {
      id: existingIndex >= 0 ? list[existingIndex].id : Date.now().toString(),
      name: name || (existingIndex >= 0 ? list[existingIndex].name : "2FA Account"),
      account: account || (existingIndex >= 0 ? list[existingIndex].account : ""),
      secret: cleanSecret,
      createdAt: new Date().toLocaleTimeString("vi-VN")
    };

    if (existingIndex >= 0) {
      list[existingIndex] = newItem;
    } else {
      list.unshift(newItem);
    }

    chrome.storage.local.set({ gen2FA: list }, () => {
      chrome.tabs.sendMessage(tabId, {
        action: "show_toast",
        message: existingIndex >= 0
          ? `GenPass: Đã cập nhật mã 2FA "${newItem.name}"!`
          : `GenPass: Đã lưu mã 2FA "${newItem.name}"!`
      });
    });
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
    chrome.storage.local.get(["gen2FA"], async (res) => {
      const list = Array.isArray(res.gen2FA) ? res.gen2FA : [];
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
          const match = list.find(item => item.name && (item.name.toLowerCase().includes(domain) || domain.includes(item.name.toLowerCase())));
          if (match) targetItem = match;
        } catch (err) {
          console.warn("Domain matching for 2FA failed:", err);
        }
      }

      const otp = await computeTotpCode(targetItem.secret);
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
    });
  }
});

function processQrResult(qrText, tabId) {
  const trimmed = qrText.trim();
  let name = "2FA Account";
  let account = "";
  let secret = "";

  if (trimmed.startsWith("otpauth://")) {
    const parsed = parseOtpAuthUrl(trimmed);
    if (parsed && parsed.secret) {
      name = parsed.name;
      account = parsed.account;
      secret = parsed.secret;
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

  save2FaCredential(name, account, secret, tabId);
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

// Initial check on worker load
checkForUpdates();
