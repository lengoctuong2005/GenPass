// GenPass Content Script - Auto-Save Prompt & Auto-Fill
(function () {
  let activeDialog = null;
  let activeToast = null;
  let lastSubmittedCredentials = null;
  let lastSubmittedPaymentCard = null;
  let lastContextMenuTarget = null;

  document.addEventListener("contextmenu", (e) => {
    lastContextMenuTarget = e.target;
  }, true);

  function extractDomain() {
    return window.location.hostname.replace(/^www\./i, "");
  }

  function sameDomain(a, b) {
    try {
      return new URL(a).hostname.replace(/^www\./i, "") === new URL(b).hostname.replace(/^www\./i, "");
    } catch (e) {
      return false;
    }
  }

  function isFillable(el) {
    return el && el.type !== "hidden" && (el.offsetParent !== null || el.getClientRects().length > 0);
  }

  function showInPageToast(message) {
    if (activeToast) activeToast.remove();
    const toast = document.createElement("div");
    toast.id = "genpass-inpage-toast";
    toast.textContent = message;
    document.body.appendChild(toast);
    activeToast = toast;
    setTimeout(() => {
      toast.remove();
      if (activeToast === toast) activeToast = null;
    }, 2400);
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

  // Kho dang bat: content script khong tu giai mai, nho service worker lam
  function vaultEnabled(res) {
    return !!res && res.genOptions && res.genOptions.vaultEnabled === true;
  }

  function gpGet(keys, cb) {
    chrome.storage.local.get(["genOptions"], (o) => {
      if (!vaultEnabled(o)) {
        chrome.storage.local.get(keys, cb);
        return;
      }
      chrome.runtime.sendMessage({ action: "vault_get", keys: keys }, (res) => {
        cb(res && res.__locked ? {} : (res || {}));
      });
    });
  }

  function gpSet(items, cb) {
    chrome.storage.local.get(["genOptions"], (o) => {
      if (!vaultEnabled(o)) {
        chrome.storage.local.set(items, cb);
        return;
      }
      chrome.runtime.sendMessage({ action: "vault_put", items: items }, (res) => {
        if (cb) cb(res || {});
      });
    });
  }

  // Set input value using native prototype descriptor to bypass React/Vue 16+ synthetic event value interception
  function setNativeValue(element, value) {
    if (!element) return;
    const proto = element instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor && descriptor.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function findUsernameInputElement(passInput) {
    const form = passInput.form;
    const inputs = form ? Array.from(form.querySelectorAll("input")) : Array.from(document.querySelectorAll("input"));

    // 1. Look for autocomplete attributes
    const autoUser = inputs.find(i => i !== passInput && (i.autocomplete === "username" || i.autocomplete === "email"));
    if (autoUser) return autoUser;

    // 2. Look for email type
    const emailInput = inputs.find(i => i !== passInput && i.type === "email");
    if (emailInput) return emailInput;

    // 3. Look for text input with name/id containing user, email, login, account
    const namedInput = inputs.find(i => {
      if (i === passInput || i.type === "password" || i.type === "hidden" || i.type === "submit") return false;
      const attr = (i.name + " " + i.id + " " + (i.placeholder || "")).toLowerCase();
      return /(user|email|login|account|phone|tài khoản|tendangnhap)/i.test(attr);
    });
    if (namedInput) return namedInput;

    // 4. Look for the closest text-like input directly before the password input
    const passIndex = inputs.indexOf(passInput);
    if (passIndex > 0) {
      for (let j = passIndex - 1; j >= 0; j--) {
        const prev = inputs[j];
        if (prev.type === "text" || prev.type === "email" || prev.type === "tel") {
          return prev;
        }
      }
    }

    return null;
  }

  function findUsernameInput(passInput) {
    const el = findUsernameInputElement(passInput);
    return el && el.value ? el.value.trim() : "";
  }

  // Autofill chỉ điền khi origin khớp và ô nhập đang hiện hình, tránh lộ credential sang trang/ô khác
  // --- Auto-Fill Badge on Web Inputs ---
  function initAutoFillBadges() {
    gpGet(["genOptions", "genHistory"], (res) => {
      if (res.genOptions && res.genOptions.autoFillBadge === false) {
        return; // Disabled by user
      }

      const domain = extractDomain().toLowerCase();
      const history = Array.isArray(res.genHistory) ? res.genHistory : [];
      const matching = history.filter(h => {
        // autofill chỉ điền khi origin khớp: có url thì bắt buộc cùng host, không url thì giữ khớp theo tên
        if (h.url) return sameDomain(h.url, location.href);
        return !!(h.name && (h.name.toLowerCase() === domain || domain.includes(h.name.toLowerCase())));
      });

      if (matching.length === 0) return;

      const passInputs = Array.from(document.querySelectorAll('input[type="password"]'));
      passInputs.forEach(passInput => {
        if (passInput.dataset.genpassAttached) return;
        passInput.dataset.genpassAttached = "true";

        const badge = document.createElement("div");
        badge.className = "genpass-autofill-badge";
        badge.title = "GenPass: Điền tài khoản & mật khẩu";
        badge.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 6c1.66 0 3 1.34 3 3 0 1.09-.59 2.04-1.46 2.56L14 15h-4v-2.44A2.99 2.99 0 0 1 9 10c0-1.66 1.34-3 3-3z"/></svg>`;

        function updateBadgePosition() {
          const rect = passInput.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) {
            badge.style.display = "none";
            return;
          }
          badge.style.display = "flex";
          badge.style.top = `${window.scrollY + rect.top + (rect.height - 22) / 2}px`;
          badge.style.left = `${window.scrollX + rect.right - 26}px`;
        }

        updateBadgePosition();
        window.addEventListener("resize", updateBadgePosition);
        window.addEventListener("scroll", updateBadgePosition);

        badge.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();

          const cred = matching[0];
          setNativeValue(passInput, cred.password);

          const userInput = findUsernameInputElement(passInput);
          if (userInput && cred.username) {
            setNativeValue(userInput, cred.username);
          }

          showInPageToast("GenPass: Đã điền mật khẩu!");
        });

        document.body.appendChild(badge);
      });
    });
  }

  // --- Auto-Save Prompt Dialog ---
  function triggerPrompt(username, password) {
    if (!password || password.length < 3) return;

    gpGet(["genOptions", "genHistory"], (res) => {
      if (res.genOptions && res.genOptions.autoSavePrompt === false) {
        return; // Disabled by user
      }

      const domain = extractDomain();
      const history = Array.isArray(res.genHistory) ? res.genHistory : [];

      // Don't prompt if already saved
      const alreadySaved = history.some(h => h.password === password && (h.name === domain || h.url?.includes(domain)));
      if (alreadySaved) return;

      const credKey = `${domain}:${username}:${password}`;
      if (lastSubmittedCredentials === credKey) return;
      lastSubmittedCredentials = credKey;
      setTimeout(() => { lastSubmittedCredentials = null; }, 10000);

      showSavePrompt(domain, username, password);
    });
  }

  function showSavePrompt(domain, username, password) {
    if (activeDialog) {
      activeDialog.remove();
      activeDialog = null;
    }

    const dialog = document.createElement("div");
    dialog.id = "genpass-save-dialog";

    let isPasswordMasked = true;
    const maskedPassword = "•".repeat(Math.min(password.length, 12));

    dialog.innerHTML = `
      <div class="gp-header">
        <div class="gp-brand">
          <svg class="gp-icon" viewBox="0 0 24 24">
            <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 6c1.66 0 3 1.34 3 3 0 1.09-.59 2.04-1.46 2.56L14 15h-4v-2.44A2.99 2.99 0 0 1 9 10c0-1.66 1.34-3 3-3z"/>
          </svg>
          <span>GenPass - Lưu mật khẩu?</span>
        </div>
        <button type="button" class="gp-close-btn" title="Đóng">&times;</button>
      </div>
      <div class="gp-domain">${escapeHtml(domain)}</div>
      ${username ? `
        <div class="gp-field">
          <span class="gp-label">Tài khoản</span>
          <div class="gp-value"><span>${escapeHtml(username)}</span></div>
        </div>
      ` : ""}
      <div class="gp-field">
        <span class="gp-label">Mật khẩu</span>
        <div class="gp-value">
          <span class="gp-pass-text" id="gp-pass-display">${maskedPassword}</span>
          <button type="button" class="gp-eye-btn" id="gp-btn-eye" title="Hiện mật khẩu">👁️</button>
        </div>
      </div>
      <div class="gp-actions">
        <button type="button" class="gp-btn gp-btn-cancel" id="gp-btn-no">Không</button>
        <button type="button" class="gp-btn gp-btn-save" id="gp-btn-yes">Lưu</button>
      </div>
    `;

    // Eye toggle
    const eyeBtn = dialog.querySelector("#gp-btn-eye");
    const passDisplay = dialog.querySelector("#gp-pass-display");
    eyeBtn.addEventListener("click", () => {
      isPasswordMasked = !isPasswordMasked;
      passDisplay.textContent = isPasswordMasked ? maskedPassword : password;
      eyeBtn.title = isPasswordMasked ? "Hiện mật khẩu" : "Ẩn mật khẩu";
    });

    // Close button
    dialog.querySelector(".gp-close-btn").addEventListener("click", () => {
      dialog.remove();
      activeDialog = null;
    });

    // No button
    dialog.querySelector("#gp-btn-no").addEventListener("click", () => {
      dialog.remove();
      activeDialog = null;
    });

    // Save button
    const saveBtn = dialog.querySelector("#gp-btn-yes");
    saveBtn.addEventListener("click", () => {
      gpGet(["genHistory"], (res) => {
        const history = Array.isArray(res.genHistory) ? res.genHistory : [];

        const newItem = {
          id: Date.now().toString(),
          name: domain,
          username: username,
          tag: "",
          url: window.location.href,
          password: password,
          length: password.length,
          createdAt: new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) + " " + new Date().toLocaleDateString("vi-VN")
        };

        history.unshift(newItem);
        if (history.length > 200) history.pop();

        gpSet({ genHistory: history }, () => {
          saveBtn.textContent = "Đã lưu!";
          saveBtn.style.backgroundColor = "#10b981";
          setTimeout(() => {
            dialog.remove();
            activeDialog = null;
          }, 900);
        });
      });
    });

    document.body.appendChild(dialog);
    activeDialog = dialog;

    setTimeout(() => {
      if (activeDialog === dialog) {
        dialog.remove();
        activeDialog = null;
      }
    }, 25000);
  }

  // --- Payment Card Detection & Auto-Save Prompt ---
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

  function detectCardBrand(num) {
    const clean = (num || "").replace(/\D/g, "");
    if (/^4/.test(clean)) return { brand: "Visa", code: "visa" };
    if (/^(5[1-5]|2[2-7])/.test(clean)) return { brand: "Mastercard", code: "mastercard" };
    if (/^3[47]/.test(clean)) return { brand: "Amex", code: "amex" };
    if (/^35(2[89]|[3-8][0-9])/.test(clean)) return { brand: "JCB", code: "jcb" };
    if (/^9704/.test(clean)) return { brand: "Napas", code: "napas" };
    return { brand: "Thẻ", code: "generic" };
  }

  function maskCardNumber(num) {
    const clean = (num || "").replace(/\D/g, "");
    if (clean.length <= 4) return clean;
    const last4 = clean.slice(-4);
    const maskedPrefix = clean.slice(0, -4).replace(/\d/g, "•");
    return (maskedPrefix + last4).replace(/(.{4})(?=.)/g, "$1 ");
  }

  function findPaymentFormFields(formOrContext) {
    const root = formOrContext || document;
    const inputs = Array.from(root.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"])'));
    if (inputs.length === 0) return null;

    let cardNumInput = inputs.find(i => {
      if (i.autocomplete === "cc-number") return true;
      const attr = (i.name + " " + i.id + " " + (i.placeholder || "")).toLowerCase();
      return /(card[-_]?num|cardnumber|cc[-_]?num|credit[-_]?card|so[-_]?the|pan|card_no)/i.test(attr);
    });

    if (!cardNumInput) {
      cardNumInput = inputs.find(i => {
        const clean = (i.value || "").replace(/\D/g, "");
        return clean.length >= 12 && clean.length <= 19 && validateLuhn(clean);
      });
    }

    if (!cardNumInput || !cardNumInput.value) return null;
    const rawNumber = cardNumInput.value.replace(/\D/g, "");
    if (rawNumber.length < 12 || !validateLuhn(rawNumber)) return null;

    const holderInput = inputs.find(i => {
      if (i === cardNumInput) return false;
      if (i.autocomplete === "cc-name") return true;
      const attr = (i.name + " " + i.id + " " + (i.placeholder || "")).toLowerCase();
      return /(card[-_]?holder|cc[-_]?name|ten[-_]?chu[-_]?the|name[-_]?on[-_]?card|card_name)/i.test(attr);
    });

    const expInput = inputs.find(i => {
      if (i === cardNumInput) return false;
      if (i.autocomplete === "cc-exp") return true;
      const attr = (i.name + " " + i.id + " " + (i.placeholder || "")).toLowerCase();
      return /(cc[-_]?exp|exp[-_]?date|card[-_]?exp|expiry|han[-_]?the)/i.test(attr);
    });

    const cvvInput = inputs.find(i => {
      if (i === cardNumInput) return false;
      if (["cc-csc", "cc-cvc", "cc-cvv"].includes(i.autocomplete)) return true;
      const attr = (i.name + " " + i.id + " " + (i.placeholder || "")).toLowerCase();
      return /(cvv|cvc|csc|security[-_]?code|ma[-_]?bao[-_]?mat)/i.test(attr);
    });

    const emailInput = inputs.find(i => i.type === "email" || /email/i.test(i.name + " " + i.id));
    const phoneInput = inputs.find(i => i.type === "tel" || /(phone|tel|sdt)/i.test(i.name + " " + i.id));
    const zipInput = inputs.find(i => i.autocomplete === "postal-code" || /(zip|postal)/i.test(i.name + " " + i.id));
    const addressInput = inputs.find(i => i.autocomplete === "street-address" || /(address|dia[-_]?chi)/i.test(i.name + " " + i.id));
    const cityInput = inputs.find(i => i.autocomplete === "address-level2" || /(city|thanh[-_]?pho)/i.test(i.name + " " + i.id));

    return {
      cardNumber: rawNumber,
      cardholderName: (holderInput ? holderInput.value.trim() : "").toUpperCase(),
      expiryDate: expInput ? expInput.value.trim() : "",
      cvv: cvvInput ? cvvInput.value.trim() : "",
      email: emailInput ? emailInput.value.trim() : "",
      phone: phoneInput ? phoneInput.value.trim() : "",
      address: addressInput ? addressInput.value.trim() : "",
      city: cityInput ? cityInput.value.trim() : "",
      zip: zipInput ? zipInput.value.trim() : ""
    };
  }

  function triggerPaymentPrompt(paymentData) {
    if (!paymentData || !paymentData.cardNumber) return;

    gpGet(["genOptions", "genCards"], (res) => {
      if (res.genOptions && res.genOptions.autoSavePrompt === false) {
        return; // Disabled by user
      }

      const domain = extractDomain();
      const cards = Array.isArray(res.genCards) ? res.genCards : [];

      const alreadySaved = cards.some(c => (c.cardNumber || "").replace(/\D/g, "") === paymentData.cardNumber);
      if (alreadySaved) return;

      const cardKey = `${domain}:${paymentData.cardNumber}`;
      if (lastSubmittedPaymentCard === cardKey) return;
      lastSubmittedPaymentCard = cardKey;
      setTimeout(() => { lastSubmittedPaymentCard = null; }, 10000);

      showSavePaymentPrompt(paymentData);
    });
  }

  function showSavePaymentPrompt(paymentData) {
    if (activeDialog) {
      activeDialog.remove();
      activeDialog = null;
    }

    const domain = extractDomain();
    const brandInfo = detectCardBrand(paymentData.cardNumber);
    const masked = maskCardNumber(paymentData.cardNumber);

    const dialog = document.createElement("div");
    dialog.id = "genpass-save-dialog";

    dialog.innerHTML = `
      <div class="gp-header">
        <div class="gp-brand">
          <svg class="gp-icon" viewBox="0 0 24 24">
            <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 6c1.66 0 3 1.34 3 3 0 1.09-.59 2.04-1.46 2.56L14 15h-4v-2.44A2.99 2.99 0 0 1 9 10c0-1.66 1.34-3 3-3z"/>
          </svg>
          <span>GenPass - Lưu thẻ thanh toán?</span>
        </div>
        <button type="button" class="gp-close-btn" title="Đóng">&times;</button>
      </div>
      <div class="gp-domain">${escapeHtml(domain)}</div>
      <div class="gp-field">
        <span class="gp-label">Thẻ (${escapeHtml(brandInfo.brand)})</span>
        <div class="gp-value"><span class="gp-pass-text">${escapeHtml(masked)}</span></div>
      </div>
      ${paymentData.cardholderName ? `
        <div class="gp-field">
          <span class="gp-label">Chủ thẻ</span>
          <div class="gp-value"><span>${escapeHtml(paymentData.cardholderName)}</span></div>
        </div>
      ` : ""}
      ${(paymentData.expiryDate || paymentData.cvv) ? `
        <div class="gp-field">
          <span class="gp-label">Hạn thẻ & CVV</span>
          <div class="gp-value"><span>${escapeHtml(paymentData.expiryDate || "--/--")} ${paymentData.cvv ? "• CVV: •••" : ""}</span></div>
        </div>
      ` : ""}
      ${paymentData.address || paymentData.city ? `
        <div class="gp-field">
          <span class="gp-label">Địa chỉ thanh toán</span>
          <div class="gp-value"><span>${escapeHtml([paymentData.address, paymentData.city, paymentData.zip].filter(Boolean).join(", "))}</span></div>
        </div>
      ` : ""}
      <div class="gp-actions">
        <button type="button" class="gp-btn gp-btn-cancel" id="gp-btn-pay-no">Không</button>
        <button type="button" class="gp-btn gp-btn-save" id="gp-btn-pay-yes">Lưu thẻ</button>
      </div>
    `;

    dialog.querySelector(".gp-close-btn").addEventListener("click", () => {
      dialog.remove();
      activeDialog = null;
    });

    dialog.querySelector("#gp-btn-pay-no").addEventListener("click", () => {
      dialog.remove();
      activeDialog = null;
    });

    const saveBtn = dialog.querySelector("#gp-btn-pay-yes");
    saveBtn.addEventListener("click", () => {
      gpGet(["genCards"], (res) => {
        const cards = Array.isArray(res.genCards) ? res.genCards : [];
        const newCard = {
          id: Date.now().toString(),
          cardName: `${brandInfo.brand} - ${domain}`,
          cardholderName: paymentData.cardholderName,
          cardNumber: paymentData.cardNumber,
          expiryDate: paymentData.expiryDate,
          cvv: paymentData.cvv,
          cardType: brandInfo.code,
          email: paymentData.email || "",
          phone: paymentData.phone || "",
          address: paymentData.address || "",
          city: paymentData.city || "",
          state: "",
          zip: paymentData.zip || "",
          country: "",
          note: `Lưu tự động từ ${domain}`,
          createdAt: new Date().toLocaleTimeString("vi-VN") + " " + new Date().toLocaleDateString("vi-VN")
        };
        cards.unshift(newCard);
        gpSet({ genCards: cards }, () => {
          saveBtn.textContent = "Đã lưu!";
          saveBtn.style.backgroundColor = "#10b981";
          setTimeout(() => {
            dialog.remove();
            activeDialog = null;
          }, 900);
          showInPageToast("GenPass: Đã lưu thông tin thẻ thanh toán!");
        });
      });
    });

    document.body.appendChild(dialog);
    activeDialog = dialog;

    setTimeout(() => {
      if (activeDialog === dialog) {
        dialog.remove();
        activeDialog = null;
      }
    }, 25000);
  }

  function inspectAndTriggerPaymentPrompt(formOrContext) {
    const paymentData = findPaymentFormFields(formOrContext);
    if (paymentData && paymentData.cardNumber) {
      triggerPaymentPrompt(paymentData);
    }
  }

  // --- Form & Submit Listeners ---
  document.addEventListener("submit", (e) => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    const passInput = form.querySelector('input[type="password"]');
    if (passInput && passInput.value) {
      const username = findUsernameInput(passInput);
      triggerPrompt(username, passInput.value);
    }
    inspectAndTriggerPaymentPrompt(form);
  }, true);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const target = e.target;
      if (target instanceof HTMLInputElement && target.type === "password" && target.value) {
        const username = findUsernameInput(target);
        triggerPrompt(username, target.value);
      }
      if (target instanceof HTMLElement) {
        inspectAndTriggerPaymentPrompt(target.form || target.closest("form") || document);
      }
    }
  }, true);

  document.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const btn = target.closest("button, input[type='submit']");
    if (!btn) return;

    const form = btn.closest("form");
    const passInput = form
      ? form.querySelector('input[type="password"]')
      : document.querySelector('input[type="password"]');

    if (passInput && passInput.value) {
      const username = findUsernameInput(passInput);
      setTimeout(() => {
        triggerPrompt(username, passInput.value);
      }, 100);
    }

    setTimeout(() => {
      inspectAndTriggerPaymentPrompt(form || document);
    }, 120);
  }, true);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && activeDialog) {
      activeDialog.remove();
      activeDialog = null;
    }
  });

  // --- Message Listener for Context Menus, 2FA Fill Action & QR Scan Candidates ---
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "show_toast" && msg.message) {
      showInPageToast(msg.message);
      sendResponse({ success: true });
      return true;
    }

    if (msg.action === "fill_generated_password" && msg.password) {
      const isEditable = (el) => el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable);
      const target = (lastContextMenuTarget && lastContextMenuTarget.closest)
        ? lastContextMenuTarget.closest('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, [contenteditable="true"]')
        : null;
      const activeEl = (document.activeElement && document.activeElement.closest)
        ? document.activeElement.closest('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, [contenteditable="true"]')
        : null;
      const finalTarget = (isEditable(target) ? target : null) || (isEditable(activeEl) ? activeEl : null);

      try {
        navigator.clipboard.writeText(msg.password);
      } catch (err) {
        console.warn("Clipboard write failed:", err);
      }

      if (finalTarget) {
        setNativeValue(finalTarget, msg.password);
        showInPageToast(`GenPass: Đã tạo và điền ${msg.label || "mật khẩu"}!`);
        sendResponse({ success: true, filled: true });
      } else {
        showInPageToast(`GenPass: Đã sao chép ${msg.label || "mật khẩu"} vào bộ nhớ tạm!`);
        sendResponse({ success: true, filled: false });
      }
      return true;
    }

    if (msg.action === "trigger_autofill_creds") {
      gpGet(["genHistory"], (res) => {
        const domain = extractDomain().toLowerCase();
        const history = Array.isArray(res.genHistory) ? res.genHistory : [];
        const matching = history.filter(h => {
          const nameMatch = h.name && (h.name.toLowerCase() === domain || domain.includes(h.name.toLowerCase()));
          const urlMatch = h.url && h.url.toLowerCase().includes(domain);
          return nameMatch || urlMatch;
        });

        if (matching.length === 0) {
          showInPageToast("GenPass: Không tìm thấy tài khoản đã lưu cho trang web này!");
          sendResponse({ success: false });
          return;
        }

        const cred = matching[0];
        // Khớp domain thôi chưa đủ: có url thì phải cùng origin mới được điền
        if (cred.url && !sameDomain(cred.url, location.href)) {
          showInPageToast("GenPass: Không tìm thấy tài khoản đã lưu cho trang web này!");
          sendResponse({ success: false });
          return;
        }
        const passInput = document.querySelector('input[type="password"]');
        if (passInput && isFillable(passInput)) {
          setNativeValue(passInput, cred.password);
          const userInput = findUsernameInputElement(passInput);
          if (userInput && cred.username && isFillable(userInput)) {
            setNativeValue(userInput, cred.username);
          }
          showInPageToast(`GenPass: Đã điền thông tin tài khoản "${cred.username || domain}"!`);
          sendResponse({ success: true });
        } else {
          showInPageToast("GenPass: Không tìm thấy ô mật khẩu trên trang này!");
          sendResponse({ success: false });
        }
      });
      return true;
    }

    if (msg.action === "decode_image_element" && msg.srcUrl) {
      const img = Array.from(document.querySelectorAll("img")).find(i => i.src === msg.srcUrl || i.currentSrc === msg.srcUrl) || lastContextMenuTarget;
      if (img && (img instanceof HTMLImageElement || img instanceof HTMLCanvasElement)) {
        try {
          const canvas = document.createElement("canvas");
          const width = img.naturalWidth || img.width;
          const height = img.naturalHeight || img.height;
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0);
          const imgData = ctx.getImageData(0, 0, width, height);
          if (typeof jsQR === "function") {
            const code = jsQR(imgData.data, width, height, { inversionAttempts: "attemptBoth" });
            if (code && code.data) {
              sendResponse({ qrText: code.data });
              return true;
            }
          }
        } catch (err) {
          console.warn("QR image decode failed:", err);
        }
      }
      sendResponse({ qrText: null });
      return true;
    }

    if (msg.action === "find_page_qr_candidates") {
      try {
        // 1. Look for otpauth:// links or data attributes
        const links = Array.from(document.querySelectorAll('a[href^="otpauth://"], [data-url^="otpauth://"], [data-uri^="otpauth://"]'));
        for (const link of links) {
          const href = link.getAttribute("href") || link.getAttribute("data-url") || link.getAttribute("data-uri");
          if (href && href.startsWith("otpauth://")) {
            sendResponse({ otpUrl: href });
            return true;
          }
        }

        // 2. Candidate images (QR codes on 2FA setup screens)
        const candidates = [];
        const imgs = Array.from(document.querySelectorAll("img"));
        for (const img of imgs) {
          const src = img.currentSrc || img.src;
          if (!src) continue;
          const rect = img.getBoundingClientRect();
          const isSquareLike = rect.width >= 60 && rect.height >= 60 && Math.abs(rect.width - rect.height) < Math.max(rect.width, rect.height) * 0.4;
          const hasKeywords = /(qr|otp|totp|2fa|auth|barcode)/i.test(src + " " + (img.alt || "") + " " + (img.className || "") + " " + (img.id || ""));
          if (hasKeywords || isSquareLike) {
            candidates.push(src);
          }
        }

        // 3. Canvases
        const canvases = Array.from(document.querySelectorAll("canvas"));
        for (const cvs of canvases) {
          try {
            if (cvs.width >= 60 && cvs.height >= 60) {
              candidates.push(cvs.toDataURL());
            }
          } catch (err) {
            console.warn("Canvas toDataURL failed:", err);
          }
        }

        sendResponse({ candidates: candidates.slice(0, 10) });
      } catch (err) {
        sendResponse({ candidates: [] });
      }
      return true;
    }

    if (msg.action === "fill_2fa" && msg.code) {
      // OTP chỉ điền ở top frame: chống iframe origin khác đọc được mã
      if (window.top !== window.self) {
        sendResponse({ success: false });
        return true;
      }
      const cleanCode = msg.code.replace(/\s+/g, "");

      // Look for OTP/2FA inputs
      const allInputs = Array.from(document.querySelectorAll("input")).filter(i => {
        if (i.type === "hidden" || i.type === "submit" || i.type === "checkbox" || i.type === "radio") return false;
        return true;
      });

      const otpInputs = allInputs.filter(i => {
        const attr = (i.name + " " + i.id + " " + i.autocomplete + " " + (i.placeholder || "")).toLowerCase();
        return (
          attr.includes("one-time-code") ||
          attr.includes("otp") ||
          attr.includes("2fa") ||
          attr.includes("totp") ||
          attr.includes("auth") ||
          attr.includes("xác thực") ||
          attr.includes("mã") ||
          i.maxLength === 6 ||
          i.maxLength === 8
        );
      });

      let filled = false;

      // Case 1: Exactly 6 single-digit inputs (e.g. GitHub, Google verification box)
      const singleDigitInputs = allInputs.filter(i => i.maxLength === 1);
      if (singleDigitInputs.length === 6) {
        for (let k = 0; k < 6; k++) {
          setNativeValue(singleDigitInputs[k], cleanCode[k] || "");
        }
        singleDigitInputs[5].focus();
        filled = true;
      } else if (otpInputs.length > 0) {
        // Case 2: One 6-digit input
        const targetInput = otpInputs[0];
        setNativeValue(targetInput, cleanCode);
        targetInput.focus();
        filled = true;
      }

      if (filled) {
        showInPageToast(`GenPass: Đã điền mã 2FA${msg.accountName ? ` ("${msg.accountName}")` : ""}!`);
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false });
      }
      return true;
    }
  });

  // Init badges on document idle / load
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAutoFillBadges);
  } else {
    initAutoFillBadges();
  }
})();
