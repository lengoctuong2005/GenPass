# Báo cáo Audit: Front-end / UI-UX / Accessibility / XSS-sink — Tiện ích GenPass

- **Người thực hiện**: Senior Front-end Engineer & Accessibility Reviewer
- **Ngày**: 2026-10-11
- **Phạm vi**: `popup.html` (695 dòng), `popup.css` (2481 dòng), `content.css` (251 dòng), các phần render/DOM của `popup.js` (4349 dòng), `content.js` (830 dòng), `background.js` (775 dòng), `manifest.json`
- **Repo**: https://github.com/lengoctuong2005/GenPass (commit `b4a9b7f`)

## 0. Phương pháp & giới hạn (đọc trước khi dùng báo cáo)

**Đã kiểm tra được (có bằng chứng chạy thật):**
- Đối chiếu ID giữa `popup.html` và `popup.js` bằng script (`getElementById` ↔ `id="..."`).
- Trích xuất & so khớp từ điển `I18N` (VI/EN) với các thuộc tính `data-i18n*` trong HTML bằng script.
- Tính tỉ lệ tương phản màu (WCAG 2.x) bằng công thức relative-luminance (script Node).
- Grep toàn repo các sink nguy hiểm (`innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function`, `javascript:`, `setTimeout(string)`).
- Kiểm tra thủ công từng vị trí `innerHTML` có nội suy `${...}` để xác định dữ liệu có được escape hay không.

**KHÔNG kiểm chứng được trong môi trường này (cần nói rõ để tránh hiểu sai):**
- **Chưa render thật** popup trong Chrome → các kết luận về layout ở 416px, focus ring thực tế, dark mode là **phân tích tĩnh từ CSS**, không phải ảnh chụp.
- Chưa chạy axe/Lighthouse/WAVE; các vi phạm WCAG nêu ở đây dựa trên đối chiếu mã nguồn + công thức, không có báo cáo công cụ.
- Tỉ lệ tương phản được tính trên **màu nền khai báo trong CSS** (chưa tính gradient/ảnh nền hay trạng thái hover/active).
- Không đánh giá được hành vi của `jsqr.js`, `vendor/hash-wasm.umd.js`, `wordlist.js` (thư viện bên thứ ba, ngoài phạm vi).
- Không có bằng chứng về exploit XSS thực tế — kết luận XSS là "không tìm thấy sink khai thác được", không phải "đã chứng minh an toàn tuyệt đối".

---

## 1. Bảng tổng hợp mức độ

| Mức độ | Số lượng | ID |
|---|---|---|
| **Critical** | 0 | — |
| **High** | 8 | FE-01, FE-12, FE-13, FE-29, FE-30, FE-31, FE-32, FE-41 |
| **Medium** | 16 | FE-02, FE-03, FE-04, FE-05, FE-14, FE-15, FE-16, FE-17, FE-33, FE-34, FE-35, FE-36, FE-37, FE-38, FE-42, FE-43 |
| **Low** | 14 | FE-06, FE-07, FE-08, FE-10, FE-18, FE-19, FE-20, FE-24, FE-25, FE-28b, FE-39, FE-44, FE-45, FE-47 |
| **Info** | 12 | FE-09, FE-11, FE-11b, FE-21, FE-22, FE-23, FE-26, FE-27, FE-28, FE-40, FE-46, FE-48 |
| **Tổng** | **50** | (bao gồm cả mục con FE-11b, FE-28b) |

> Ghi chú: không có lỗi **Critical**. Toàn bộ sink HTML-injection đều đã được xử lý (escape/`textContent`), nên phần XSS chỉ còn mức Info/Low.

---

## A. popup.html — Cấu trúc, ngữ nghĩa, ARIA, đối chiếu ID

### FE-01 — Tab widget thiếu toàn bộ ARIA và không điều hướng được bằng bàn phím
- **Mức độ**: High
- **Nhóm**: Accessibility / HTML semantics
- **Vị trí**: `popup.html:24-39`; logic: `popup.js:3030-3052`

Bằng chứng (HTML):
```html
24:      <nav id="nav-tabs" class="nav-tabs" aria-label="Main tabs">
25:        <button id="tab-gen" class="tab-btn active" type="button" data-i18n="tabs.generator">Mật khẩu</button>
26:        <button id="tab-history" class="tab-btn" type="button">
...
38:        <button id="tab-about" class="tab-btn" type="button" data-i18n="tabs.about">Ủng hộ</button>
```
Bằng chứng (JS) — chỉ đổi class, không đụng ARIA:
```js
3030:  function switchTab(tabEl, viewEl) {
3031:    [els.tabGen, els.tabHistory, els.tab2Fa, els.tabCards, els.tabCookies, els.tabAbout].forEach(t => t?.classList.remove("active"));
3032:    [els.viewGen, els.viewHistory, els.view2Fa, els.viewCards, els.viewCookies, els.viewAbout].forEach(v => v?.classList.remove("active"));
3033:    tabEl?.classList.add("active");
3034:    viewEl?.classList.add("active");
```
Grep xác nhận: `grep -nE 'role=|aria-selected|aria-controls|aria-live|tabindex' popup.js` → **không có kết quả nào**.

- **Tác động**: Đây là một tab widget nhưng: (1) không có `role="tablist"` / `role="tab"` / `role="tabpanel"`; (2) không có `aria-selected` / `aria-controls` / `aria-labelledby`; (3) không có điều hướng mũi tên trái/phải, không có `aria-current`. Screen reader chỉ đọc "6 nút" và **không thông báo tab nào đang được chọn**; người dùng bàn phím không thể chuyển tab theo chuẩn tab widget (WCAG 4.1.2, và best practice ARIA APG). Việc dùng `<nav>` cho một tab widget cũng gây nhầm lẫn landmark.
- **Cách sửa**: Thêm `role="tablist"` cho `#nav-tabs`, `role="tab"` + `aria-selected="true|false"` + `aria-controls="view-..."` cho từng nút, `role="tabpanel"` + `aria-labelledby="tab-..."` + `tabindex="0"` cho từng `<main class="view-panel">`; trong `switchTab()` cập nhật `aria-selected` và `tabindex`; thêm handler `keydown` cho ArrowLeft/ArrowRight/Home/End.

---

### FE-02 — Có 6 phần tử `<main>` trong cùng một document (HTML không hợp lệ)
- **Mức độ**: Medium
- **Nhóm**: HTML validity
- **Vị trí**: `popup.html:72, 295, 328, 358, 444, 502`

Bằng chứng:
```html
72:    <main id="view-gen" class="view-panel active">
295:    <main id="view-history" class="view-panel">
328:    <main id="view-2fa" class="view-panel">
358:    <main id="view-cards" class="view-panel">
444:    <main id="view-cookies" class="view-panel">
502:    <main id="view-about" class="view-panel">
```
(`grep -c '<main' popup.html` → `6`). Các panel này ẩn bằng CSS `.view-panel { display: none }` (`popup.css:221-225`) **chứ không dùng thuộc tính `hidden`**.
- **Tác động**: Theo HTML Standard, một document không được có nhiều hơn một `<main>` (trừ khi các `<main>` phụ có `hidden`). Markup hiện tại không hợp lệ → công cụ validate/SEO/a11y có thể báo lỗi; một số AT có thể coi cả 6 vùng là "main landmark" trong DOM (dù `display:none` che 5 cái, hành vi không đảm bảo đồng nhất giữa các AT).
- **Cách sửa**: Đổi 5 panel không active thành `<section>` (hoặc `<div role="tabpanel">`), giữ duy nhất một `<main>`; hoặc dùng `<main hidden>` + `role="tabpanel"` như FE-01.

---

### FE-03 — Hàng loạt input chỉ có `placeholder`, không có `<label>` liên kết
- **Mức độ**: Medium
- **Nhóm**: Accessibility (WCAG 3.3.2 / 4.1.2)
- **Vị trí** (trích dẫn tiêu biểu):
  - `popup.html:76` — `<input type="text" id="password-display" readonly spellcheck="false" autocomplete="off">` (không có `aria-label`, không có `<label>`)
  - `popup.html:102-104` — `#password-name`, `#password-user` (chỉ `placeholder`), `#password-tag` (chỉ `title="Chọn nhãn phân loại"`)
  - `popup.html:110` — `#password-note`
  - `popup.html:318, 433, 491` — các ô tìm kiếm `#input-search-history`, `#input-search-cards`, `#input-search-cookies`
  - `popup.html:342-343` — `#input-2fa-name`, `#input-2fa-secret`
  - `popup.html:369-418` — toàn bộ nhóm `#input-card-*` (chỉ có `<label>` cho `#input-card-exp` L379 và `#input-card-cvv` L383)
  - `popup.html:466, 477, 599, 617, 618, 639, 673` — `#input-cookie-profile-name`, `#textarea-import-cookies-json`, `#input-new-tag`, `#vault-pin-new`, `#vault-pin-confirm`, `#vault-pin-off`, `#textarea-import-csv`
- **Tác động**: Placeholder không phải label: nó biến mất khi người dùng nhập, độ tương phản thường thấp, và nhiều AT không đọc placeholder ổn định. Người dùng screen reader không biết ô nào là "Số thẻ", ô nào là "Email thanh toán" (nhóm 10+ ô liền nhau). Vi phạm WCAG 3.3.2 "Labels or Instructions".
- **Cách sửa**: Thêm `<label for="...">` (ẩn bằng class `.sr-only` nếu muốn giữ UI gọn) hoặc tối thiểu `aria-label` cho từng input; riêng `#password-tag` (select) phải có `<label>`.

---

### FE-04 — Nút chỉ có icon dùng `title` làm tên truy cập; SVG không có `aria-hidden`
- **Mức độ**: Medium
- **Nhóm**: Accessibility
- **Vị trí**: `popup.html:78, 84, 91, 319, 386, 434, 492, 595, 614, 635, 655`

Bằng chứng:
```html
78:            <button id="btn-toggle-mask" class="icon-btn" title="Ẩn/Hiện mật khẩu" type="button">
84:            <button id="btn-refresh" class="icon-btn" title="Tạo mật khẩu mới" type="button">
319:        <button type="button" id="btn-clear-search" class="clear-search-btn" title="Xóa tìm kiếm" hidden>&times;</button>
386:                <button type="button" id="btn-toggle-card-cvv" class="cvv-eye-btn" title="Ẩn/Hiện CVV">
635:          <button id="btn-close-vault-off" class="icon-btn-small" type="button" title="Đóng">&times;</button>
```
Chỉ 3 SVG trong toàn file có `aria-hidden="true"` (`popup.html:505, 520, 524` — đều ở tab About). Các SVG icon ở L79-82, L85-89, L92-95, L314-317, L387-390, L429-432, L487-490 **không có** `aria-hidden`, không có `<title>`.

- **Tác động**: `title` chỉ là phương án dự phòng tên truy cập cuối cùng; nó không xuất hiện khi focus bằng bàn phím một cách nhất quán và không được một số AT hỗ trợ. Icon SVG không `aria-hidden` có thể bị đọc lẫn hoặc gây nhiễu.
- **Cách sửa**: Thêm `aria-label` (bản dịch) cho các nút icon, đồng thời `aria-hidden="true"` + `focusable="false"` cho mọi `<svg>` trang trí.


---

### FE-05 — `<div>`/`<span>` có handler `click` nhưng không phải control (không dùng được bàn phím)
- **Mức độ**: Medium
- **Nhóm**: Accessibility (WCAG 2.1.1 Keyboard)
- **Vị trí** (đã kiểm chứng bằng grep `addEventListener("click"`):
```js
1959:      nameEl.addEventListener("click", startEdit);                       // <span class="history-name">
1970:        userRow.addEventListener("click", () => { ... });                 // <div class="history-user-row">
1985:      passEl.addEventListener("click", () => { ... });                    // <span class="history-pass">
2005:        noteEl.addEventListener("click", () => { ... });                  // <div class="history-note">
2131:      codeEl.addEventListener("click", () => { ... });                    // <span class="twofa-code">
3341:      numSpan.addEventListener("click", () => { ... });                   // <span class="payment-card-masked-number">
3398:      holderVal.addEventListener("click", () => { ... });                 // <span class="payment-card-holder">
3416:      expVal.addEventListener("click", () => { ... });                    // <span class="payment-card-exp">
3430:      cvvVal.addEventListener("click", () => { ... });                    // <span class="payment-card-cvv">
3545:          addrSpan.addEventListener("click", () => { ... });              // <span> địa chỉ
3560:          contactSpan.addEventListener("click", () => { ... });           // <span> liên hệ
3577:        noteEl.addEventListener("click", () => { ... });                  // <div class="payment-card-note">
```
Các phần tử này được tạo bằng `document.createElement("span"|"div")` và **không** gán `role="button"`, `tabindex="0"`, cũng không có `keydown` cho Enter/Space.
- **Tác động**: Các hành vi quan trọng — sao chép mật khẩu, sao chép OTP, sao chép số thẻ/CVV, đổi tên mục lịch sử — **chỉ dùng được bằng chuột**. Người dùng bàn phím/screen reader không thể kích hoạt. Vi phạm WCAG 2.1.1.
- **Cách sửa**: Đổi thành `<button type="button" class="link-like">`, hoặc thêm `role="button" tabindex="0"` + xử lý `keydown` (Enter/Space). Ưu tiên dùng `<button>` để có sẵn ngữ nghĩa và focus.

---

### FE-06 — Modal thiếu `role="dialog"`, `aria-modal`, `aria-labelledby`; không có focus trap/khôi phục focus
- **Mức độ**: Low
- **Nhóm**: Accessibility
- **Vị trí**: `popup.html:591` (`#modal-tags`), `610` (`#modal-vault-pin`), `631` (`#modal-vault-disable`), `651` (`#modal-import-csv`); logic: `popup.js:2976-2979`, `2991-3008`

Bằng chứng:
```html
591:    <div id="modal-tags" class="modal-backdrop" hidden>
592:      <div class="modal-container">
593:        <div class="modal-header">
594:          <span class="modal-title">Quản lý nhãn</span>
```
```js
2976:  els.btnOpenTags.addEventListener("click", () => {
2977:    els.modalTags.hidden = false;
2978:    renderTagsManageList();
2979:    els.inputNewTag.focus();
```
Điểm tốt: đã có `Escape` để đóng modal (`popup.js:2991-3007`) và đã tự focus input khi mở.
- **Tác động**: Screen reader không được thông báo đây là hộp thoại, không đọc được tiêu đề; `Tab` có thể đi ra ngoài modal (không trap); khi đóng modal focus không được trả về nút đã mở.
- **Cách sửa**: Thêm `role="dialog" aria-modal="true" aria-labelledby="<id tiêu đề>"` cho `.modal-container`; trap focus trong modal khi mở; lưu `document.activeElement` trước khi mở và `.focus()` lại khi đóng.


---

### FE-07 — `aria-label` hardcode, không dịch theo ngôn ngữ
- **Mức độ**: Low
- **Nhóm**: i18n / Accessibility
- **Vị trí**: `popup.html:24`, `popup.html:51`
```html
24:      <nav id="nav-tabs" class="nav-tabs" aria-label="Main tabs">
51:          <input type="password" id="vault-pin" autocomplete="off" maxlength="64" placeholder="Mã PIN hoặc mật khẩu" aria-label="Mã PIN hoặc mật khẩu" data-i18n-placeholder="vault.pinPlaceholder">
```
- **Tác động**: Khi chọn EN, `aria-label` của `#vault-pin` vẫn tiếng Việt (chỉ `placeholder` được cập nhật qua `data-i18n-placeholder`); `aria-label="Main tabs"` luôn tiếng Anh dù UI tiếng Việt. Người dùng screen reader nhận ngôn ngữ hỗn hợp.
- **Cách sửa**: Thêm cơ chế `data-i18n-aria-label` (tương tự `data-i18n-title` đã có) và bổ sung 2 khóa `nav.tabs` + `vault.pinAria` vào từ điển.

---

### FE-08 — Markup chết / trùng lặp
- **Mức độ**: Low
- **Nhóm**: Maintainability
- **Vị trí**: `popup.html:60`
```html
60:    <div id="update-banner" class="update-banner" hidden style="display: none;">
```
Bằng chứng JS + CSS cho thấy inline style là **dư thừa**:
```js
2580:    els.updateBanner.hidden = false;
2581:    els.updateBanner.style.display = "flex";
```
```css
1240: .update-banner[hidden] { display: none !important; }
```
- Ngoài ra, script đối chiếu ID cho thấy 3 id trong HTML không được `getElementById` tham chiếu: `icon-eye` (chỉ là hook nội dung), `search-cards-row`, `search-cookies-row` (chỉ dùng làm container, không cần id).
- **Tác động**: Dễ gây nhầm lẫn "hai nguồn sự thật" (attribute `hidden` vs inline style vs `!important`); id không dùng làm nhiễu khi bảo trì.
- **Cách sửa**: Bỏ `style="display: none;"` ở L60, chỉ dùng `hidden`; gỡ 3 id không cần thiết.

---

### FE-09 — `<!DOCTYPE>`, `meta`, `lang`, `<title>` (Điểm tốt)
- **Mức độ**: Info
- **Nhóm**: HTML validity
- **Vị trí**: `popup.html:1-6`
```html
1: <!DOCTYPE html>
2: <html lang="vi">
4:   <meta charset="UTF-8">
6:   <title>GenPass</title>
```
Doctype chuẩn, `charset` đặt đúng, `lang` có và **được cập nhật động** khi đổi ngôn ngữ (`popup.js:604: document.documentElement.lang = currentLang;`). `meta viewport` (L5) là vô hại trong popup.

---

### FE-10 — Ảnh QR có `src=""` và `alt=""` ban đầu
- **Mức độ**: Low
- **Nhóm**: Accessibility / HTML
- **Vị trí**: `popup.html:539`
```html
539:              <img id="about-qr-img" src="" alt="" width="224" height="224" decoding="async" loading="lazy" hidden>
```
- **Tác động**: `alt` rỗng + `src=""` có thể khiến trình duyệt cố load URL hiện tại (popup.html) và ghi log lỗi; `alt` chỉ được set trong JS (`popup.js:648: els.aboutQrImg.alt = ...`) khi `renderAbout()` chạy. Nếu `renderAbout` chưa chạy, ảnh có `alt` rỗng (được coi là ảnh trang trí — nhưng ảnh QR **không** trang trí, nó mang thông tin thanh toán).
- **Cách sửa**: Bỏ `src=""`, thêm `alt` mặc định có nghĩa (ví dụ "Mã VietQR chuyển khoản") ngay trong HTML.

---

### FE-11 — Không có inline event handler; mọi `<button>` đều có `type` (Điểm tốt)
- **Mức độ**: Info
- **Nhóm**: HTML / bảo mật
- **Vị trí**: toàn `popup.html`
- `grep -nE 'on[a-z]+="' popup.html` → chỉ khớp `meta name="viewport"`, **không có** `onclick=`/`onload=` nào.
- `grep '<button' popup.html | grep -v 'type='` → **rỗng** ⇒ mọi nút đều khai báo `type="button"` (tránh hành vi submit mặc định).
- Không có `<form>` (`grep -c '<form' popup.html` → `0`).
- **Tác động**: Tốt cho CSP (`script-src 'self'` trong `manifest.json:7`) và cho việc tách markup/behavior.

---

### FE-11b — Đối chiếu ID giữa `popup.html` và `popup.js` (kết quả script)
- **Mức độ**: Info
- **Nhóm**: Maintainability
- **Phương pháp**: `grep -oE 'id="[^"]+"' popup.html | sort` vs `grep -oE 'getElementById\("[^"]+"\)' popup.js | sort -u`, sau đó `comm`.

| Kiểm tra | Kết quả |
|---|---|
| Tổng số `id` trong `popup.html` | 167 |
| Số `id` được `getElementById` trong `popup.js` | 164 |
| **`id` trong HTML không được JS tham chiếu** | `icon-eye`, `search-cards-row`, `search-cookies-row` (3) |
| **`id` JS tham chiếu nhưng không có trong HTML (id chết/`null`)** | **Không có (0)** |
| `id` trùng lặp trong `popup.html` | **Không có (0)** |
| `querySelector("#...")` trong `popup.js` | Không có |

- **Kết luận**: **Không có mismatch nghiêm trọng** — mọi `getElementById` đều trỏ tới phần tử tồn tại, không có `id` trùng. Đây là điểm tốt (nhiều codebase có `els.foo === null` do typo). 3 id không dùng chỉ là dư thừa nhẹ.
- **Cách sửa**: Gỡ 3 id không dùng (hoặc giữ nếu cần hook CSS).


---

## B. popup.css (+ content.css) — Tính đúng đắn, khả năng bảo trì, layout, dark mode

### FE-12 — Checkbox bị `display: none` ⇒ không thể focus/toggle bằng bàn phím và biến mất khỏi a11y tree
- **Mức độ**: **High**
- **Nhóm**: Accessibility (WCAG 2.1.1, 4.1.2)
- **Vị trí**: `popup.css:453-455`
```css
453: .toggle-item input[type="checkbox"] {
454:   display: none;
455: }
```
- **Phạm vi ảnh hưởng**: **12 checkbox** trong `popup.html`: `#opt-upper` (L149), `#opt-lower` (L155), `#opt-numbers` (L161), `#opt-special` (L167), `#opt-avoid-ambiguous` (L173), `#opt-autosave-prompt` (L245), `#opt-autofill` (L251), `#opt-auto-clear-clipboard` (L257), `#opt-vault-enabled` (L266), `#opt-vault-lock-close` (L273), `#opt-passphrase-capitalize` (L229), `#opt-passphrase-number` (L235).
- **Tác động**: `display:none` loại phần tử khỏi **cả** cây accessibility **và** thứ tự tab. Người dùng bàn phím **không thể** bật/tắt bất kỳ tùy chọn nào (chữ hoa/thường/số/ký tự đặc biệt, tự động điền, tự xóa clipboard, bật kho mã hóa…). Screen reader không biết có checkbox nào. Đây là lỗi accessibility nghiêm trọng nhất trong CSS — các tùy chọn cốt lõi của tiện ích bị khóa khỏi người dùng AT. (`<label>` bao ngoài chỉ giúp chuột.)
- **Cách sửa**: Thay `display:none` bằng kỹ thuật "visually hidden nhưng vẫn focusable":
  ```css
  .toggle-item input[type="checkbox"] {
    position: absolute; opacity: 0; width: 1px; height: 1px; margin: 0;
  }
  .toggle-item input[type="checkbox"]:focus-visible + .checkbox-custom {
    outline: 2px solid var(--border-focus); outline-offset: 2px;
  }
  ```


---

### FE-13 — Tương phản chữ thấp hơn WCAG AA ở nhiều chỗ (đặc biệt `--text-muted`)
- **Mức độ**: **High**
- **Nhóm**: Accessibility (WCAG 1.4.3 Contrast Minimum)
- **Vị trí**: biến màu tại `popup.css:7` và `popup.css:29`; các chỗ dùng `var(--text-muted)` tại `popup.css:687, 697, 739, 764, 829, 902, 915, 1057, 1287, 1311, 1340, 1477, 1712, 1738, 1989, 2101, 2106, 2463, …`
```css
7:  --text-muted: #94a3b8;
...
29:    --text-muted: #64748b;   /* trong @media (prefers-color-scheme: dark) */
```
**Tỉ lệ tương phản đo bằng công thức WCAG (script Node):**

| Cặp màu | Tỉ lệ | Ngưỡng AA (text thường 4.5:1) | Kết luận |
|---|---|---|---|
| `#94a3b8` (text-muted) trên `#f8fafc` (bg-primary, light) | **2.45:1** | 4.5:1 | ❌ FAIL |
| `#94a3b8` trên `#ffffff` (bg-card, light) | **2.56:1** | 4.5:1 | ❌ FAIL |
| `#64748b` (text-muted, dark) trên `#0f172a` | **3.75:1** | 4.5:1 | ❌ FAIL |
| `#64748b` (text-secondary) trên `#f8fafc` | 4.55:1 | 4.5:1 | ⚠️ Vừa đủ |
| `#94a3b8` trên `#1e293b` (dark card) | 5.71:1 | 4.5:1 | ✅ PASS |

- **Tác động**: `--text-muted` được dùng cho chữ **10–11px** (ví dụ `.history-time` L737-739, `.empty-state` L761-766, `.card-sub-field label` L1709-1714, `.payment-card-note` L1970-1978, `.about-footer-note` L2461-2465). Ở light mode chỉ đạt 2.45–2.56:1 ⇒ **không đọc được** với người thị lực kém; ở dark mode 3.75:1 vẫn dưới ngưỡng 4.5:1 cho chữ nhỏ. Ngoài ra `--danger #ef4444` + chữ trắng = **3.76:1** (`popup.css:1252-1256` `.update-badge`, `.btn-text.danger` L608-614) và `--success #10b981` + trắng = **2.54:1** ⇒ cũng dưới ngưỡng.
- **Cách sửa**: Tối `--text-muted` light xuống khoảng `#475569` (≈7:1) và dark lên `#a8b6c8`; với chữ ≤ 11px nên yêu cầu ≥ 4.5:1; nền đỏ/xanh thì dùng chữ đen hoặc tăng độ đậm nền.

---

### FE-14 — `outline: none` không có chỉ báo focus thay thế
- **Mức độ**: Medium
- **Nhóm**: Accessibility (WCAG 2.4.7 Focus Visible)
- **Vị trí**: 16 vị trí `outline: none` trong `popup.css`: dòng `258, 334, 351, 422, 723, 865, 955, 996, 1216, 1325, 1363, 1398, 1437, 1510, 1633, 2197`
- **Trường hợp đặc biệt nặng** — slider không có `:focus` nào:
```css
417: input[type="range"] {
418:   width: 100%;
419:   height: 6px;
422:   outline: none;
424:   accent-color: var(--accent);
425: }
```
  Các trường hợp khác (ví dụ `#password-display:focus` L264, `#password-name:focus` L338, `#input-search-history:focus` L1329, `.csv-textarea:focus` L1516, `.select-input:focus` L1220) chỉ đổi `border-color` 1px — **không** phải chỉ báo focus đủ tương phản/đủ lớn (WCAG 2.4.11 Focus Appearance).
- **Tác động**: Người dùng bàn phím không biết mình đang ở đâu khi tab tới slider độ dài, các ô input, textarea; với slider thì **hoàn toàn không có** chỉ báo. Không có bất kỳ `:focus-visible` nào trong toàn bộ CSS (`grep -n ':focus-visible' popup.css` → rỗng).
- **Cách sửa**: Bổ sung `:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }` toàn cục (hoặc cho từng control), đặc biệt là `input[type="range"]`.

---

### FE-15 — Không tôn trọng `prefers-reduced-motion`; animation/transition không tối ưu
- **Mức độ**: Medium
- **Nhóm**: Accessibility (WCAG 2.3.3) / Performance
- **Vị trí**: `popup.css:798, 801`, `popup.css:379`, `popup.css:1101`; `content.css:22, 250`
```css
798:  animation: modalScale 0.18s cubic-bezier(0.16, 1, 0.3, 1);
801: @keyframes modalScale { from { transform: scale(0.92); opacity: 0; } to { transform: scale(1); opacity: 1; } }
```
```css
379:  transition: width 0.3s ease, background 0.3s ease;          /* .strength-bar */
1101:  transition: width 1s linear, background-color 0.3s ease;   /* .twofa-progress-fill */
```
`grep -n 'prefers-reduced-motion' popup.css content.css` → **không có kết quả**.
- **Tác động**: Modal scale-in, toast slide-in (`content.css:22`), thanh tiến trình OTP chạy `width` 1s liên tục mỗi giây — người dùng bật "giảm chuyển động" vẫn bị. Transition trên `width` (thuộc tính layout) gây reflow mỗi giây ở tab 2FA (vòng `setInterval` 1000ms gọi `render2FA()` tại `popup.js:2195-2202`) ⇒ tốn CPU trong popup.
- **Cách sửa**: Thêm `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; } }`; chuyển thanh tiến trình sang `transform: scaleX()` thay vì `width`.

---

### FE-16 — Toast (z-index 999) nằm **dưới** modal (z-index 1000) ⇒ bị che khi modal đang mở
- **Mức độ**: Medium
- **Nhóm**: UI/UX, z-index
- **Vị trí**: `popup.css:1146-1167` (toast), `popup.css:769-781` (modal), `popup.css:2151` (vault overlay)
```css
1167:  z-index: 999;      /* .toast */
781:  z-index: 1000;     /* .modal-backdrop */
2151:  z-index: 2000; /* cao hon modal (1000) va toast (999) */
```
Toast là **sibling** của `.modal-backdrop` trong `.app-container` (`popup.html:686` nằm sau `popup.html:591-683`), `position: fixed`.
- **Tác động**: Có **rất nhiều** thông báo phát sinh trong lúc modal mở, ví dụ `showToast("Nhãn đã tồn tại!")` (`popup.js:3014`) khi modal Quản lý nhãn đang mở. Người dùng **không thấy** phản hồi vì toast nằm sau lớp phủ `rgba(0,0,0,0.45)` và sau `.modal-container`.
- **Cách sửa**: Nâng `.toast { z-index: 3000 }` (trên cả vault overlay 2000) hoặc render toast trong một layer riêng ở `document.body`.


---

### FE-17 — 91 mã màu hex hardcode ngoài `:root` ⇒ dark mode không phủ
- **Mức độ**: Medium
- **Nhóm**: Maintainability / Dark mode
- **Vị trí** (tiêu biểu): `popup.css:1667-1695` (badge thương hiệu thẻ), `popup.css:1772-1813` (nền thẻ thanh toán), `popup.css:1853, 1885, 1922, 1929, 1954, 1972, 2001, 2005`, `popup.css:1148-1149` (toast)
```css
1667: .card-brand-badge.visa { background: #1a1f71; color: #fff; border-color: #1a1f71; }
1772: .payment-card-item { background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); color: #f8fafc; ... }
1148:  background: #0f172a;
1149:  color: #fff;
```
Số liệu: `grep -oE '#[0-9a-fA-F]{3,8}\b' popup.css | wc -l` → **91**; `rgba(` → **20**; `var(--…` → **314** (17 biến). Chỉ có **một** khối dark mode duy nhất (`popup.css:22-36`) và nó chỉ đổi biến.
- **Tác động**: Phần thẻ thanh toán cố tình làm "thẻ nhựa tối" nên chấp nhận được, nhưng nhiều màu (`color: #94a3b8` trong `.icon-btn-card` L1885, `#cbd5e1` L2005, `#f1f5f9` L1871) không theo biến ⇒ không đồng bộ khi đổi theme, và rủi ro bảo trì: đổi bảng màu phải sửa thủ công 91 chỗ.
- **Cách sửa**: Chuyển các màu lặp lại thành biến (`--card-ink`, `--brand-visa`, …) hoặc dùng `color-mix()` / `light-dark()`.

---

### FE-18 — Kích thước popup cố định 440px; breakpoint duy nhất không bao giờ khớp
- **Mức độ**: Low
- **Nhóm**: Layout / Responsive
- **Vị trí**: `popup.css:45-55` và `popup.css:76-85`
```css
45: body {
46:   width: 440px;
47:   min-height: 520px;
...
52:   overflow-x: hidden;
...
76: @media (min-width: 500px) {
77:   body {
78:     width: 440px;
79:     margin: 32px auto;
80:     border: 1px solid var(--border);
81:     border-radius: var(--radius);
83:     min-height: auto;
84:   }
85: }
```
- **Tác động**: `width: 440px` + `.app-container { padding: 12px }` (`popup.css:87-92`) ⇒ **vùng nội dung = 440 − 24 = 416px**, khớp mô tả "416px" trong `task.md:50`. Tuy nhiên `overflow-x: hidden` trên `body` có thể **che mất** nội dung tràn ngang (ví dụ thanh 6 tab `.nav-tabs` tại `popup.css:157-171` với `flex-shrink: 0` trên `.tab-btn` L201) mà không có dấu hiệu "còn nội dung". `@media (min-width: 500px)` chỉ kích hoạt khi popup được mở như một **tab thật** (`popup.html?tab=…`, xem `popup.js:2805-2812`), còn trong popup thật (≤ 440px) thì nhánh này vô nghĩa.
- **Cách sửa**: Cân nhắc `width: min(440px, 100vw)`; kiểm tra `.nav-tabs` với 6 tab ở 416px (đã có `overflow-x: auto` + wheel handler `popup.js:3067-3072` nên tạm ổn) — nhưng nên thêm gradient/fade gợi ý còn nội dung cuộn.

---

### FE-19 — Danh sách dài có `max-height: 420px`; tổng thể popup không có vùng cuộn thống nhất
- **Mức độ**: Low
- **Nhóm**: Layout / Overflow
- **Vị trí**: `popup.css:616-623` (`.history-list`), `popup.css:2059-2066` (`.cookie-profiles-list`), `popup.css:1761-1768` (`.cards-list`); thanh trượt `popup.css:57-74`, `popup.css:174-186`
```css
616: .history-list { ... max-height: 420px; overflow-y: auto; padding-right: 2px; }
```
- **Tác động**: Trong popup Chrome cao tối đa ~600px, danh sách 420px + header + search + tag bar có thể khiến popup phải cuộn toàn trang; `body` không quy định `max-height`/`overflow-y` nên hành vi cuộn phụ thuộc trình duyệt. `min-height: 520px` (L47) có thể tạo khoảng trắng lớn ở tab ít nội dung (ví dụ tab About khi PayPal bị ẩn — `popup.js:661-671`).
- **Cách sửa**: Đặt vùng cuộn ở `.view-panel.active` với `overflow-y: auto` và `max-height: calc(100vh - <chiều cao header>)`; cân nhắc giảm `min-height`.

---

### FE-20 — `transition: all` dùng nhiều nơi (không tối ưu)
- **Mức độ**: Low
- **Nhóm**: Performance
- **Vị trí**: `popup.css:145, 202, 464, 600, 892, 1165, 1186, 1202, 2076, 2132` (ví dụ `.btn-lang`, `.tab-btn`, `.checkbox-custom`, `.btn-text`, `.icon-btn-card`)
```css
202:  transition: all 0.15s ease;   /* .tab-btn */
```
- **Tác động**: `transition: all` vô tình animate cả `width/height/padding/color` → nhiều repaint hơn cần thiết; khó kiểm soát.
- **Cách sửa**: Liệt kê thuộc tính cụ thể (`transition: background-color .15s, color .15s, border-color .15s`).

---

### FE-21 — `!important`: hợp lý ở `popup.css`, rất nhiều ở `content.css`
- **Mức độ**: Info
- **Nhóm**: Maintainability
- **Vị trí**: `popup.css` chỉ **4** lần: dòng `785` (`.modal-backdrop[hidden]`), `1225` (`[hidden]`), `1241` (`.update-banner[hidden]`), `2154` (`.vault-lock[hidden]`) — tất cả đều phục vụ việc ẩn phần tử có `display:flex`, **chấp nhận được**.
- `content.css` có **146** lần `!important` trên 251 dòng (`grep -c '!important' content.css` → 146). Đây là hệ quả của chiến lược chống style của trang host (`content.css:3: all: initial;`), **có lý do kỹ thuật**, nhưng cực kỳ khó bảo trì.
- **Cách sửa**: Với `content.css`, cân nhắc Shadow DOM để giảm nhu cầu `!important`.

---

### FE-22 — Không phát hiện rule CSS chết rõ ràng
- **Mức độ**: Info
- **Nhóm**: Maintainability
- **Phương pháp**: Trích 221 class selector trong `popup.css` và đối chiếu với class dùng trong `popup.html` + `popup.js`.
- **Kết quả**: các ứng viên "không dùng" (`amex`, `visa`, `jcb`, `mastercard`, `napas`, `empty`, `history-name`, `history-url`, `warning`) đều là **dương tính giả**: class `brand-*` được sinh động (`popup.js:3308: cardEl.className = \`payment-card-item brand-${brandInfo.code}\``), còn `history-name`/`empty` gán qua ternary (`popup.js:1841`). **Không có selector thừa đáng kể.**
- **Trùng lặp selector**: script chỉ thấy `:root` (L1, L23) và `body` (L45, L77) xuất hiện 2 lần — nhưng lần thứ hai nằm trong `@media`, nên **không phải** rule trùng thực sự.


---

## C. XSS / Unsafe DOM Sinks

### FE-23 — Không tìm thấy sink nguy hiểm cấp cao (Điểm tốt)
- **Mức độ**: Info
- **Nhóm**: Security / XSS
- **Phương pháp**: `grep -rnE 'eval\(|new Function|insertAdjacentHTML|outerHTML|document\.write|javascript:' --include='*.js' --include='*.html' .` (loại trừ `vendor/`, `jsqr.js`)
- **Kết quả**: `NONE FOUND`.
- Bổ sung: không có `setTimeout("…")`/`setInterval("…")` dạng chuỗi, không có `setAttribute("on*", …)`, không có `href="javascript:"` (grep `javascript:` → rỗng).
- **Kết luận**: Bề mặt tấn công DOM-injection của tiện ích **rất nhỏ**.

---

### FE-24 — Kiểm kê toàn bộ `innerHTML` trong `popup.js` (đều an toàn)
- **Mức độ**: Low
- **Nhóm**: Security / XSS
- **Phương pháp**: grep toàn bộ `innerHTML` rồi phân loại: (a) chuỗi tĩnh, (b) chuỗi rỗng, (c) có nội suy `${…}` — kiểm tra thủ công từng trường hợp (c).

**Bảng sink:**

| Dòng | Nội dung | Dữ liệu nội suy | Escape? | Đánh giá |
|---|---|---|---|---|
| `1027` | `` `<option value="">Không nhãn</option>` `` | không có | — | An toàn |
| `1040, 1069, 1147, 1799, 2064, 3281, 3774, 3837, 3951` | `innerHTML = ""` | không có | — | An toàn (xóa nội dung) |
| `1085` | `` `<span class="tag-manage-name">${escapeHtml(tag)}</span>…(${count})` `` | `tag` (nhãn do người dùng đặt), `count` (number) | ✅ `escapeHtml` | An toàn |
| `1873` | `` `<option value="${escapeHtml(t)}" ${t === item.tag ? "selected" : ""}>${escapeHtml(t)}</option>` `` | `t` (tên nhãn) | ✅ cả attribute & text | An toàn |
| `1968` | `` `<span class="history-user-icon">👤</span><span class="history-user-text">${escapeHtml(item.username)}</span>` `` | `item.username` (từ vault) | ✅ | An toàn |
| `1094, 1157, 1858, 2020, 2031, 2045, 2153, 2161, 2172, 3355, 3371, 3453, 3481, 3507, 3911, 3921, 3963, 3976` | Chuỗi SVG tĩnh hoặc ternary của 2 chuỗi SVG tĩnh (`EYE_ON_SVG`/`EYE_OFF_SVG`) | không có | — | An toàn |

`escapeHtml` định nghĩa tại `popup.js:992-1000`:
```js
992:  function escapeHtml(str) {
993:    if (!str) return "";
994:    return String(str)
995:      .replace(/&/g, "&amp;")
996:      .replace(/</g, "&lt;")
997:      .replace(/>/g, "&gt;")
998:      .replace(/"/g, "&quot;")
999:      .replace(/'/g, "&#039;");
```
- **Đánh giá khai thác**: **Không khai thác được.** Toàn bộ dữ liệu có thể do người dùng/kho kiểm soát (tên site, tên tài khoản, nhãn, ghi chú, số thẻ, cookie domain/value, tên 2FA) đều đi qua `textContent` (hàng trăm chỗ) hoặc `escapeHtml()` (3 chỗ `innerHTML` có nội suy). Ngay cả kết quả quét QR (dữ liệu do **trang web độc hại** cung cấp) cũng chỉ được đưa vào `textContent` (`popup.js:2101: nameEl.textContent = item.name;`, `popup.js:2129: codeEl.textContent = formattedCode;`).
- **Lưu ý nhỏ**: `escapeHtml` trả `""` cho giá trị falsy (`0`, `false`) — không gây XSS, chỉ là hành vi cần biết.
- **Cách sửa (phòng ngừa)**: Chuyển 3 chỗ `innerHTML` có nội suy sang `createElement` + `textContent` để không phụ thuộc vào `escapeHtml`.

---

### FE-25 — `content.js` — 2 dialog in-page dùng `innerHTML` với nội suy, đã escape đầy đủ
- **Mức độ**: Low
- **Nhóm**: Security / XSS (content script — rủi ro cao hơn vì chạy trong ngữ cảnh trang web)
- **Vị trí**: `content.js:236-262` (dialog lưu mật khẩu), `content.js:463-499` (dialog lưu thẻ)

Bằng chứng:
```js
246:      <div class="gp-domain">${escapeHtml(domain)}</div>
250:          <div class="gp-value"><span>${escapeHtml(username)}</span></div>
473:      <div class="gp-domain">${escapeHtml(domain)}</div>
475:        <span class="gp-label">Thẻ (${escapeHtml(brandInfo.brand)})</span>
481:          <div class="gp-value"><span>${escapeHtml(paymentData.cardholderName)}</span></div>
487:          <div class="gp-value"><span>${escapeHtml(paymentData.expiryDate || "--/--")} ${paymentData.cvv ? "• CVV: •••" : ""}</span></div>
493:          <div class="gp-value"><span>${escapeHtml([paymentData.address, paymentData.city, paymentData.zip].filter(Boolean).join(", "))}</span></div>
```
`escapeHtml` trong `content.js:42-50` escape đúng `& < > " '`. Biến `maskedPassword` (`content.js:234`) chỉ phụ thuộc **độ dài**, không chứa ký tự do kẻ tấn công chọn.
- **Đánh giá khai thác**: **Không khai thác được.** `domain` lấy từ URL trang (`content.js:298: url: window.location.href`) — trang độc hại kiểm soát hoàn toàn (ví dụ path chứa `"><img src=x onerror=...>`), **nhưng** đã bị `escapeHtml` vô hiệu hóa.
- **Cách sửa**: Giữ nguyên; thêm comment giải thích vì sao mọi nội suy bắt buộc phải `escapeHtml` để tránh hồi quy.


---

### FE-26 — `img.src` nhận URL do trang web kiểm soát (không phải XSS, nhưng là rò rỉ quyền riêng tư)
- **Mức độ**: Info
- **Nhóm**: Security / Privacy
- **Vị trí**: `popup.js:904` (`img.src = src;`), `popup.js:946` (`img.src = candidateSrc;`)
```js
944:        for (const candidateSrc of candidates) {
...
946:            img.src = candidateSrc;
```
`candidates` đến từ `chrome.tabs.sendMessage(..., { action: "find_page_qr_candidates" })` → do content script thu thập từ ảnh của trang, tức **trang web kiểm soát**.
- **Đánh giá khai thác**: Không phải XSS (gán `img.src` không thực thi script). Tuy nhiên popup (`chrome-extension://…`) sẽ phát request tới URL tuỳ ý do trang chỉ định — có thể dùng để (a) phát hiện sự tồn tại của extension, (b) dò mạng nội bộ phía client (SSRF; `background.js` có `isSafeFetchUrl` nhưng luồng `img.src` này **không** đi qua hàm đó), (c) làm chậm popup. CSP popup (`manifest.json:7`) **không** khai báo `img-src`/`default-src` ⇒ ảnh tải từ mọi nguồn được phép.
- **Cách sửa**: Chỉ chấp nhận `data:`, `blob:` hoặc `src` cùng origin với tab; thêm `img-src 'self' data: https:` vào CSP; hoặc để background fetch (đã có filter SSRF).

---

### FE-27 — `chrome.tabs.create({ url: targetUrl })` với URL lấy từ dữ liệu lưu
- **Mức độ**: Info
- **Nhóm**: Security
- **Vị trí**: `popup.js:4006` và `popup.js:4025`
```js
4006:      const targetUrl = profile.url || (targetDomain ? `https://${targetDomain}` : "https://example.com");
4025:          chrome.tabs.create({ url: targetUrl });
```
`profile.url` được gán từ URL tab hiện tại khi lưu phiên (`popup.js:4083, 4094, 4152`) hoặc từ `activeTab.url` khi import JSON — **không** lấy trực tiếp từ trường trong JSON cookie.
- **Đánh giá khai thác**: Trong luồng hiện tại, `profile.url` luôn là `http(s)://…` ⇒ **không khai thác được** để mở `javascript:`/`data:`. Rủi ro chỉ tăng nếu tương lai cho phép nhập `url` từ file JSON bên ngoài.
- **Cách sửa**: Kiểm tra `new URL(targetUrl).protocol` ∈ {`http:`, `https:`} trước khi `tabs.create`.

---

### FE-28 — `escapeHtml` trùng lặp ở 2 file (không phải bug, ghi nhận để tránh hồi quy)
- **Mức độ**: Info
- **Nhóm**: Security / Maintainability
- Hàm `escapeHtml` tồn tại ở **cả** `popup.js:992` và `content.js:42` (code trùng lặp). Không có nơi nào dùng `innerHTML` với dữ liệu chưa escape.
- **Cách sửa**: Tách `escapeHtml` vào một module dùng chung (`utils.js`) và nạp ở cả popup + content để tránh lệch hành vi khi sửa một bên.

---

### FE-28b — `prepareCookieForSet` nhận dữ liệu cookie thô từ JSON dán vào
- **Mức độ**: Low
- **Nhóm**: Security (attribute injection vào API `chrome.cookies.set`)
- **Vị trí**: `popup.js:3738-3759`, dùng tại `popup.js:4012` và `popup.js:4160`
```js
3743:    const clean = {
3744:      url: cleanUrl,
3745:      name: c.name,
3746:      value: c.value || "",
3747:      path: c.path || "/"
3748:    };
3749:    if (c.domain && !c.hostOnly) { clean.domain = c.domain; }
3751:    if (c.secure !== undefined) clean.secure = !!c.secure;
3752:    if (c.httpOnly !== undefined) clean.httpOnly = !!c.httpOnly;
```
`c.name`, `c.value`, `c.domain`, `c.path` đến trực tiếp từ `JSON.parse` nội dung người dùng dán vào `#textarea-import-cookies-json` (`popup.js:4135`).
- **Tác động**: Người dùng có thể vô tình (hoặc bị lừa) dán JSON đặt cookie `httpOnly`/`secure` cho domain bất kỳ. Đây là hành vi **cố ý của tính năng** nhưng UI không cảnh báo "dữ liệu dán vào sẽ ghi cookie thật vào trình duyệt"; `c.domain` không được kiểm tra khớp domain tab.
- **Cách sửa**: Cảnh báo rõ trong UI; giới hạn `clean.domain` theo domain của tab hiện tại (trừ khi người dùng xác nhận).


---

## D. i18n — Tính nhất quán VI/EN

### FE-29 — Từ điển có 80 khóa nhưng chỉ **32** khóa được gắn vào markup; **46** khóa hoàn toàn không được dùng
- **Mức độ**: **High**
- **Nhóm**: i18n
- **Vị trí**: từ điển `popup.js:430-595`; hàm áp dụng `popup.js:601-632`

Số liệu chạy bằng script:

| Chỉ số | Giá trị |
|---|---|
| Khóa `data-i18n*` xuất hiện trong `popup.html` | **32** |
| Số khóa trong từ điển VI | **80** |
| Số khóa trong từ điển EN | **80** |
| (a) Khóa HTML **thiếu** trong VI dict | **0** |
| (a) Khóa HTML **thiếu** trong EN dict | **0** |
| (b) Khóa dict **không dùng trong markup** | **48** |
| (c) Khóa chỉ có ở VI hoặc chỉ có ở EN | **0** |
| (d) Cặp VI/EN trùng giá trị | 3 (`about.title`, `about.qrLabel`, `about.paypalLabel`) |

48 khóa không dùng trong markup:
```
gen.copyBtn, gen.copied, gen.namePlaceholder, gen.userPlaceholder, gen.notePlaceholder,
gen.strengthLabel, gen.modePassword, gen.modePassphrase, gen.length, gen.optUpper, gen.optLower,
gen.optNumbers, gen.optSpecial, gen.optAmbiguous, gen.advanced, gen.minNumbers, gen.minSpecial,
gen.words, gen.separator, gen.passphraseCap, gen.passphraseNum, settings.autosave, settings.autofill,
settings.autoClearClipboard, settings.vaultHeader, settings.vaultNote, settings.vaultEnable,
settings.vaultLockClose, settings.vaultTimeout, settings.vaultChangePin, history.title, history.import,
history.export, history.tags, history.clear, history.searchPlaceholder, twofa.title, twofa.add,
twofa.scan, twofa.upload, cards.title, cards.add, cookies.title, cookies.saveSession, cookies.import,
cookies.export, cookies.logout, about.copied
```
Trong 48 khóa này, chỉ **2** được dùng qua hàm `t()` (`about.copy`, `about.copied` — `popup.js:3111-3113, 3123-3125`; grep `t("…")` trong `popup.js` chỉ trả về 2 kết quả này). **46 khóa là code chết.**

- **Tác động**: Từ điển trông "đầy đủ 80+ khóa" (đúng như `task.md:34` tuyên bố, và test `tests/security-i18n.test.cjs` kiểm "80 matching bilingual keys"), nhưng **hầu hết khóa không bao giờ được áp dụng** vì phần tử HTML tương ứng không có `data-i18n`. Test chỉ kiểm tra *tính đối xứng VI↔EN của từ điển*, **không** kiểm tra từ điển có được nối vào DOM hay không ⇒ cảm giác an toàn giả.
- **Cách sửa**: Gắn `data-i18n` cho các phần tử tương ứng (xem FE-30) hoặc xóa 46 khóa chết; bổ sung test kiểm tra mọi khóa trong dict đều được tham chiếu ở HTML/JS.


---

### FE-30 — ~96 chuỗi text + 20 `title` + 26 `placeholder` hardcode tiếng Việt (không có `data-i18n`)
- **Mức độ**: **High**
- **Nhóm**: i18n
- **Vị trí**: rải khắp `popup.html`

Số liệu chạy bằng script:

| Loại | Tổng số | Số có `data-i18n*` | Số hardcode tiếng Việt |
|---|---|---|---|
| Text node (chuỗi hiển thị) | 135 | 32 | **96** chứa ký tự tiếng Việt |
| `title="…"` | 25 | **1** (`data-i18n-title` tại L67) | 20 chứa ký tự tiếng Việt |
| `placeholder="…"` | 30 | **1** (`data-i18n-placeholder` tại L51) | 26 chứa ký tự tiếng Việt |

Ví dụ tiêu biểu (đều **không** có `data-i18n`):
```html
 96:              <span>Sao chép</span>
119:            <span>Độ mạnh:</span>
127:        <button type="button" id="btn-mode-password" class="mode-btn active">Mật khẩu</button>
128:        <button type="button" id="btn-mode-passphrase" class="mode-btn">Cụm từ (Passphrase)</button>
136:            <label for="length-range">Độ dài</label>
151:            <span class="toggle-label">Chữ hoa (A-Z)</span>
181:          <summary>Tùy chọn nâng cao</summary>
262:        <div class="vault-settings-divider"><span>BẢO MẬT KHO</span></div>
288:            <button id="btn-vault-change-pin" class="btn-text" type="button">Đổi mã PIN</button>
297:        <span class="history-title">Lịch sử</span>
300:          <button id="btn-import-csv" class="btn-text" type="button" title="Nhập mật khẩu từ file CSV">Nhập</button>
330:        <span class="twofa-title">Mã 2FA</span>
360:        <span class="cards-title">Hồ sơ thanh toán</span>
447:          <span class="cookies-title">Quản lý Cookies</span>
454:          <button id="btn-clear-domain-cookies" class="btn-text danger" type="button" title="Xóa toàn bộ cookies của trang web này để đăng xuất">Đăng xuất</button>
664:            <span class="drop-text">Kéo thả file .csv vào đây hoặc</span>
686:    <div id="toast" class="toast">Đã sao chép vào bộ nhớ tạm!</div>
```
Đối chiếu: trong khi đó `popup.js:445-506` đã có sẵn các khóa `gen.copyBtn`, `gen.strengthLabel`, `gen.modePassword`, `gen.length`, `gen.optUpper`, `gen.advanced`, `settings.vaultHeader`, `settings.vaultChangePin`, `history.title`, `history.import`, `twofa.title`, `cards.title`, `cookies.title`, `cookies.logout`, … nhưng **không được gắn** vào markup.

- **Tác động**: Khi người dùng bấm nút "EN", **phần lớn giao diện vẫn là tiếng Việt** — chỉ 32 chuỗi (tab, vault lock, update banner, tab About) đổi sang tiếng Anh. Đây là khiếm khuyết nghiêm trọng nhất của tính năng i18n: UI trở thành **song ngữ lẫn lộn**.
- **Cách sửa**: Gắn `data-i18n` / `data-i18n-placeholder` / `data-i18n-title` cho toàn bộ phần tử ở trên (dùng đúng các khóa đã có sẵn trong dict), hoặc viết lại HTML sinh động từ `I18N`.

---

### FE-31 — ~90 lời gọi `showToast("…")` hardcode tiếng Việt
- **Mức độ**: **High**
- **Nhóm**: i18n
- **Vị trí**: `popup.js` — 90 vị trí; ví dụ `772, 774, 782, 852, 864, 877, 881, 901, 909, 1110, 1133, 1176, 1455, 1478, 1488, 1607, 1921, 1973, 1988, 2008, 2024, 2134, 2165, 2179, 2219, 2258, 2319, 2324, 2339, 2417, 2419, 2529, 2534, 2539, 2547, 2638, 2884, 2911, 2920, 3014, 3021, 3148, 3168, 3191, 3196, 3261, 3345, 3376, 3402, 3421, 3440, 3474, 3512, 3548, 3564, 3580, 3646, 3651, 3657, 3700, 3708, 3939, 3968, 3981, 3999, 4028, 4053, 4058, 4065, 4072, 4171, 4176, 4184, 4227, 4248`
```js
1988:        showToast("Đã sao chép mật khẩu!");
2024:        showToast("Đã sao chép mật khẩu!");
2134:        showToast("Đã sao chép mã 2FA!");
2179:        showToast(`Đã xóa mã 2FA "${item.name}"!`);
2258:    showToast(`Đã xuất ${itemsToExport.length} mật khẩu ra CSV!`);
3261:    showToast("Đã xóa toàn bộ lịch sử.");
4248:          showToast(`Đã xóa ${cookies.length} cookies của trang & đăng xuất!`);
```
Chỉ **3** toast có xử lý song ngữ (dạng ternary thủ công):
```js
3082:      showToast(nextLang === "en" ? "Switched to English!" : "Đã chuyển sang Tiếng Việt!");
3115:      showToast(currentLang === "en" ? "Copied account number!" : "Đã sao chép số tài khoản!");
3127:      showToast(currentLang === "en" ? "Copied transfer memo!" : "Đã sao chép nội dung chuyển khoản!");
```
- **Tác động**: Ở chế độ EN, mọi phản hồi hành động (sao chép, xóa, nhập/xuất, lỗi định dạng, lỗi clipboard…) vẫn tiếng Việt. Việc dùng ternary cho 3 toast chứng tỏ tác giả biết vấn đề nhưng không làm nhất quán.
- **Cách sửa**: Đưa toàn bộ chuỗi toast vào từ điển (thêm namespace `toast.*`) và gọi `showToast(t("toast.copiedPassword"))`; với toast có tham số, dùng placeholder kiểu `t("toast.deleted2fa", { name })`.


---

### FE-32 — `applyI18n` dùng `el.textContent = …` ⇒ **xóa mất icon SVG** bên trong nút About
- **Mức độ**: **High**
- **Nhóm**: i18n / Bug UI
- **Vị trí**: `popup.js:615-618` và các phần tử bị ảnh hưởng tại `popup.html:519-526`
```js
615:      document.querySelectorAll("[data-i18n]").forEach(el => {
616:        const k = el.getAttribute("data-i18n");
617:        if (k && I18N[currentLang]?.[k]) el.textContent = I18N[currentLang][k];
618:      });
```
```html
519:          <button type="button" id="about-github" class="about-link-btn" data-i18n="about.github">
520:            <svg class="icon-small" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .3a12 12 0 0 0-3.8 23.4…"/></svg>
521:            Mã nguồn trên GitHub
522:          </button>
523:          <button type="button" id="about-license" class="about-link-btn" data-i18n="about.license">
524:            <svg class="icon-small" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">…</svg>
525:            Giấy phép MIT
526:          </button>
```
- **Tác động**: `textContent = …` **thay thế toàn bộ node con**, bao gồm `<svg>`. Ngay lần đầu người dùng bấm "EN" (hoặc lần đầu `applyI18n(o.lang)` chạy khi `genOptions.lang` đã tồn tại — `popup.js:1616`), icon GitHub và icon file trong 2 nút này **biến mất vĩnh viễn** cho tới khi popup được nạp lại. Đây là bug thực tế, không chỉ lý thuyết.
- **Cách sửa**: Tách nhãn text ra một `<span data-i18n="about.github">` bên trong nút (giống pattern ở `popup.html:27, 33`), hoặc đổi `applyI18n` sang cập nhật text node đầu tiên thay vì ghi đè `textContent`.

---

### FE-33 — Đổi ngôn ngữ **không** re-render nội dung động đã render
- **Mức độ**: Medium
- **Nhóm**: i18n
- **Vị trí**: `popup.js:601-632` (applyI18n) và `popup.js:3030-3052` (switchTab)

`applyI18n` chỉ cập nhật 3 nhóm: `[data-i18n]`, `[data-i18n-placeholder]`, `[data-i18n-title]` — cộng thêm `renderAbout()` nếu tab About đang mở (`popup.js:629-631`). Nó **không** gọi `updateHistoryUI()`, `render2FA()`, `renderCards()`, `renderCookieProfiles()`, `renderTagFilterBar()`.
- **Tác động**: Danh sách đã render (lịch sử, 2FA, thẻ, cookies, chip lọc nhãn) giữ nguyên chuỗi tiếng Việt ("Chưa đặt tên" `popup.js:1842`, "Trang hiện tại" `2115`, "Thẻ thanh toán" `3320`, "Chưa mở web" `3832`, "Tất cả (n)" `1045`, "Không nhãn" `1027`) sau khi đổi ngôn ngữ, chỉ đổi khi người dùng chuyển tab hoặc thao tác lại. Ngoài ra tab History và Generator **không** được `switchTab` render lại (`popup.js:3041-3051` chỉ render 2FA/cards/cookies/about).
- **Cách sửa**: Trong `applyI18n`, gọi lại toàn bộ hàm render đang hiển thị (`updateHistoryUI(); render2FA(); renderCards(); renderCookieProfiles(); renderTagFilterBar();`).

---

### FE-34 — Nhãn "độ mạnh" hardcode tiếng Việt trong logic
- **Mức độ**: Medium
- **Nhóm**: i18n
- **Vị trí**: `popup.js:156-208` (hiển thị tại `popup.js:2444, 2467`)
```js
156:  if (!password || poolSize <= 1) return { score: 1, label: "Rất yếu", color: "#ef4444", pct: 15 };
159:  if (entropy < 40) return { score: 1, label: "Rất yếu", color: "#ef4444", pct: 25 };
162:  return { score: 4, label: "Rất mạnh", color: "#059669", pct: 100 };
205:  if (entropy < 35) return { score: 1, label: "Rất yếu", color: "#ef4444", pct: 25 };
208:  return { score: 4, label: "Rất mạnh", color: "#059669", pct: 100 };
```
```js
2467:    els.strengthText.textContent = strength.label;
```
- **Tác động**: Ở chế độ EN, dòng "Strength: **Rất mạnh**" hiển thị lẫn ngôn ngữ. Khóa `gen.strengthLabel` trong dict là code chết (FE-29) còn nhãn giá trị thì không có khóa nào.
- **Cách sửa**: Trả về `labelKey` (ví dụ `"strength.veryStrong"`) và dịch ở tầng hiển thị; thêm 5 khóa `strength.*`.

---

### FE-35 — Ngày/giờ luôn định dạng theo locale `"vi-VN"`
- **Mức độ**: Medium
- **Nhóm**: i18n
- **Vị trí**: `popup.js:1784, 2393, 3179, 3697, 3705, 4083, 4094, 4152`; `content.js:301, 532`
```js
1784:      createdAt: new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) + " " + new Date().toLocaleDateString("vi-VN")
```
- **Tác động**: Ở chế độ EN, mốc thời gian vẫn theo định dạng Việt Nam (ngày/tháng/năm) — không nhất quán với ngôn ngữ đang chọn. Ngoài ra chuỗi được **lưu cứng** vào dữ liệu (`createdAt`) nên không thể dịch lại về sau.
- **Cách sửa**: Lưu `createdAt` dạng ISO (`new Date().toISOString()`), format khi hiển thị theo `currentLang` (`"vi-VN"` ↔ `"en-US"`).


---

### FE-36 — Không dùng `chrome.i18n` / `_locales`; không phát hiện ngôn ngữ trình duyệt
- **Mức độ**: Medium
- **Nhóm**: i18n
- **Vị trí**: `manifest.json` (không có `default_locale`), không tồn tại thư mục `_locales`; `popup.js:426`
```js
426:  let currentLang = "vi";
```
```json
3:  "name": "GenPass - Trình tạo mật khẩu",
5:  "description": "Tạo mật khẩu an toàn theo chuẩn ngành với tùy chọn độ dài, ký tự và lưu lịch sử.",
```
Kiểm tra: `ls _locales` → **không tồn tại**; `grep 'default_locale\|i18n' manifest.json` → **rỗng**; grep `chrome.i18n` toàn repo → không có.
- **Tác động**: Tên/mô tả tiện ích trong Chrome Web Store và trang quản lý extension **luôn tiếng Việt** cho mọi người dùng. Mặc định ngôn ngữ UI là `"vi"` **cứng**, không đọc `navigator.language`/`chrome.i18n.getUILanguage()` ⇒ người dùng tiếng Anh lần đầu cài vẫn thấy UI tiếng Việt.
- **Cách sửa**: Thêm `"default_locale": "vi"` + `_locales/vi/messages.json`, `_locales/en/messages.json`, dùng `chrome.i18n.getMessage` cho tên/mô tả; khởi tạo `currentLang` từ `chrome.i18n.getUILanguage().startsWith("vi") ? "vi" : "en"` khi chưa có lựa chọn lưu.

---

### FE-37 — `background.js` context menu: có song ngữ, nhưng lần cài đầu luôn mặc định tiếng Việt
- **Mức độ**: Medium
- **Nhóm**: i18n
- **Vị trí**: `background.js:35-133` (`setupContextMenus`), `background.js:136-140` (`onInstalled`), `background.js:144-152` (`storage.onChanged`)
```js
35: function setupContextMenus(lang) {
36:   const isEn = lang === "en";
...
52:      title: isEn ? "Generate password" : "Tạo mật khẩu",
```
```js
136: chrome.runtime.onInstalled.addListener(() => {
137:   chrome.storage.local.get("genOptions", (res) => {
138:     setupContextMenus(res?.genOptions?.lang || "vi");
139:   });
140: });
```
```js
144:   chrome.storage.onChanged.addListener((changes, area) => {
145:     if (area === "local" && changes.genOptions) {
...
149:       if (newLang && newLang !== oldLang) {
150:         setupContextMenus(newLang);
151:       }
```
- **Điểm tốt**: menu chuột phải **có** song ngữ và **có** cập nhật khi người dùng đổi ngôn ngữ trong popup (vì `saveOptions` ghi `genOptions` kèm `lang` — `popup.js:1219, 1223-1226`; nút toggle set `opts.lang = nextLang` tại `popup.js:3079-3080`).
- **Khoảng trống**: (1) Lần **cài đầu tiên** `genOptions` chưa tồn tại ⇒ luôn rơi vào `|| "vi"`, kể cả khi trình duyệt là tiếng Anh. (2) Không xử lý `chrome.runtime.onStartup` — nếu menu bị mất/đổi ngoài luồng storage thì không được tái tạo (rủi ro thấp vì Chrome lưu menu bền). (3) Toàn bộ chuỗi menu vẫn hardcode trong `background.js` thay vì dùng `chrome.i18n`.
- **Cách sửa**: Khởi tạo `lang` theo `chrome.i18n.getUILanguage()` khi chưa có cấu hình; dùng `chrome.i18n.getMessage` cho tiêu đề menu.

---

### FE-38 — Dialog in-page của `content.js` hardcode tiếng Việt
- **Mức độ**: Medium
- **Nhóm**: i18n
- **Vị trí**: `content.js:241, 247, 252, 261, 262, 308, 467, 471, 476, 478, 486, 489, 492, 497, 498, 536, 543`
```js
241:          <span>GenPass - Lưu mật khẩu?</span>
247:          <span class="gp-label">Tài khoản</span>
252:        <span class="gp-label">Mật khẩu</span>
261:        <button type="button" class="gp-btn gp-btn-cancel" id="gp-btn-no">Không</button>
262:        <button type="button" class="gp-btn gp-btn-save" id="gp-btn-yes">Lưu</button>
308:          saveBtn.textContent = "Đã lưu!";
```
```js
467:          <span>GenPass - Lưu thẻ thanh toán?</span>
543:          showInPageToast("GenPass: Đã lưu thông tin thẻ thanh toán!");
```
- **Tác động**: Content script **không đọc** `genOptions.lang` cho các chuỗi này (grep `data-i18n` trong `content.js` → rỗng) ⇒ dù người dùng chọn EN, prompt "Lưu mật khẩu?" trên trang web vẫn tiếng Việt. Đây là điểm i18n bị bỏ quên hoàn toàn.
- **Cách sửa**: Đọc `genOptions.lang` (đã có helper `gpGet` trong `content.js`) và chọn bộ chuỗi tương ứng, hoặc truyền `lang` từ storage vào lúc render dialog.

---

### FE-39 — `title`/`aria-label` của phần lớn nút không được dịch
- **Mức độ**: Low
- **Nhóm**: i18n
- **Vị trí**: 24/25 `title` trong `popup.html` không có `data-i18n-title`; ví dụ `popup.html:78, 84, 91, 104, 300-303, 319, 333-334, 386, 451-454, 492, 595, 614, 635, 655`
```html
300:          <button id="btn-import-csv" class="btn-text" type="button" title="Nhập mật khẩu từ file CSV">Nhập</button>
333:          <button id="btn-scan-qr" class="btn-text" type="button" title="Chụp và quét mã QR trên màn hình trang web">Quét QR</button>
```
- **Tác động**: Tooltip trợ năng (title) giữ tiếng Việt khi chuyển EN — đúng như thiết kế kỹ thuật (`applyI18n` có nhánh `data-i18n-title` tại `popup.js:623-626` nhưng chỉ 1 phần tử dùng).
- **Cách sửa**: Gắn `data-i18n-title` và bổ sung khóa tương ứng cho các title này.

---

### FE-40 — Tổng hợp 7 hạng mục i18n được yêu cầu
- **Mức độ**: Info
- **Nhóm**: i18n

| Hạng mục | Kết quả |
|---|---|
| (a) Khóa có trong HTML nhưng thiếu trong dict | **Không có** (0/32 thiếu ở cả VI và EN) ✅ |
| (b) Khóa dict không bao giờ được dùng | **46 khóa** (xem FE-29) ❌ |
| (c) Chuỗi hardcode không dịch trong HTML/JS | **~96 text + 20 title + 26 placeholder** (HTML) và **~90 toast + nhiều nhãn sinh động** (JS) ❌ |
| (d) Cặp VI/EN trùng giá trị hoặc sai ngôn ngữ | 3 cặp trùng: `about.title="GenPass"`, `about.qrLabel="VietQR (Napas 24/7)"`, `about.paypalLabel="PayPal"` — **đều là danh từ riêng**, chấp nhận được ✅ |
| (e) Chuỗi động ghép nối bỏ qua i18n | Toast có tham số (`popup.js:2179, 2258, 2419, 3512, 3939, 3968, 3981, 4028, 4248`), empty-state (`1820, 1822, 3299`), chip lọc (`1045, 1058, 3782, 3796, 3813`), nhãn strength (`156-208`) ❌ |
| (f) Đổi ngôn ngữ có re-render hết? | **Không** — chỉ 32 chuỗi + placeholder + title; không re-render list động (FE-33); **phá icon** ở 2 nút About (FE-32); `aria-label` không đổi (FE-07) ❌ |
| (g) Ngôn ngữ không áp dụng cho context menu lúc cài lần đầu | Đúng — `background.js:138` mặc định `"vi"` (FE-37); menu vẫn cập nhật khi người dùng đổi ngôn ngữ ✅/❌ |


---

## E. UX / UI issues

### FE-41 — **Không có xác nhận** cho bất kỳ hành động phá hủy nào
- **Mức độ**: **High**
- **Nhóm**: UX / Data safety
- **Vị trí**: kiểm tra `grep -nE 'confirm\(|window\.confirm|alert\(' popup.js background.js content.js` → **`NO confirm/alert found`**. Toàn bộ UI không có modal xác nhận nào ngoài các modal nhập liệu.

Các hành động phá hủy **xóa ngay lập tức** khi bấm 1 lần:

| Hành động | Vị trí | Hậu quả |
|---|---|---|
| Xóa **toàn bộ** lịch sử | `popup.js:3253-3262` (`#btn-clear-history`) | Mất hết mật khẩu đã lưu, không hoàn tác |
| Đăng xuất = xóa **tất cả** cookie của domain | `popup.js:4213-4248` (`#btn-clear-domain-cookies`) | Xóa cookie thật + reload trang |
| Xóa phiên cookie | `popup.js:3977-3982` | Mất dữ liệu phiên đã lưu |
| Xóa nhãn | `popup.js:1176` | Mất nhãn |
| Xóa mục 2FA | `popup.js:2173-2180` | Mất secret 2FA |
| Xóa hồ sơ thẻ | `popup.js:3508-3513` | Mất số thẻ/CVV đã lưu |
| Xóa mục lịch sử | `popup.js:2032-2039` | Mất mật khẩu |

Bằng chứng tiêu biểu:
```js
3253:  els.btnClearHistory.addEventListener("click", () => {
3254:    if (currentHistory.length === 0) return;
3255:    currentHistory = [];
...
3261:    showToast("Đã xóa toàn bộ lịch sử.");
```
```js
4213:  if (els.btnClearDomainCookies) {
4214:    els.btnClearDomainCookies.addEventListener("click", () => {
...
4248:          showToast(`Đã xóa ${cookies.length} cookies của trang & đăng xuất!`);
```
- **Tác động**: `#btn-clear-history` và `#btn-clear-domain-cookies` nằm cạnh các nút thao tác khác trong header (`popup.html:300-303`, `451-454`) và chỉ khác biệt bằng màu đỏ nhạt (`.btn-text.danger` = `color: var(--danger)`, `popup.css:608-610`). Một cú click nhầm (hoặc Enter khi nút đang focus) là **mất dữ liệu vĩnh viễn**. Đặc biệt "Đăng xuất" thực chất **xóa hết cookie** — mức phá hủy cao hơn tên nút gợi ý.
- **Cách sửa**: Thêm modal xác nhận (đã có sẵn pattern `.modal-backdrop`) cho tối thiểu 2 hành động xóa hàng loạt; hoặc yêu cầu gõ chữ xác nhận; bổ sung **Undo** (toast có nút "Hoàn tác") cho các xóa đơn lẻ.

---

### FE-42 — Toast bị che khi modal mở ⇒ thông báo lỗi không tới người dùng
- **Mức độ**: Medium
- **Nhóm**: UX
- **Vị trí**: xem FE-16 (`popup.css:1167` vs `popup.css:781`)
- **Tác động**: Các thông báo kiểm tra dữ liệu phát sinh **trong lúc modal mở** (ví dụ `showToast("Nhãn đã tồn tại!")` `popup.js:3014`, `showToast("Tên nhãn đã tồn tại!")` `popup.js:1110`) không nhìn thấy được. Người dùng bấm nút mà không thấy phản hồi → tưởng nút hỏng.
- **Cách sửa**: Như FE-16, hoặc hiển thị lỗi inline trong modal (pattern `#vault-pin-error` — `popup.js:1334-1337`).

---

### FE-43 — Lỗi và trạng thái không được thông báo cho screen reader (`aria-live` vắng mặt)
- **Mức độ**: Medium
- **Nhóm**: Accessibility (WCAG 4.1.3 Status Messages)
- **Vị trí**: `#vault-lock-error` (`popup.html:55`), `#vault-pin-error` (`popup.html:621`), `#vault-off-error` (`popup.html:641`), `#vault-pin-strength` (`popup.html:620`), `#toast` (`popup.html:686`); hàm `popup.js:1334-1337`
```js
1334:  function vaultShowError(el, msg) {
1335:    if (!el) return;
1336:    el.textContent = msg;
1337:    el.hidden = false;
1338:  }
```
Grep `aria-live` toàn repo → **không có**.
- **Tác động**: Khi mở khóa sai PIN, thông báo "Mã PIN không đúng" (`popup.js:1408`) xuất hiện nhưng screen reader **không đọc**; khi bấm sao chép, toast xác nhận cũng không được announce. Người dùng AT không biết thao tác thành công hay thất bại.
- **Cách sửa**: `role="status" aria-live="polite"` cho `#toast`, `role="alert" aria-live="assertive"` cho các vùng lỗi; thêm `aria-describedby` cho input liên quan.

---

### FE-44 — Phản hồi sao chép không nhất quán; không có trạng thái disabled/lỗi
- **Mức độ**: Low
- **Nhóm**: UX
- **Vị trí**: `popup.js:3107-3128` (đổi nhãn nút) so với phần còn lại (`popup.js:1988, 2024, 2134, 3345, 3376, …` chỉ toast)
```js
3111:      els.aboutCopyNumber.textContent = t("about.copied");
3112:      setTimeout(() => { els.aboutCopyNumber.textContent = t("about.copy"); }, 2000);
```
- **Tác động**: Ở tab About, nút "Chép" đổi thành "Đã chép ✓" (feedback tốt). Ở mọi nơi khác (copy mật khẩu, copy OTP, copy số thẻ) chỉ có toast 1.8s (`popup.js:960-964`) — dễ bị bỏ lỡ, và **không** có phản hồi nếu `navigator.clipboard.writeText` thất bại (không có `.catch`, không disable nút).
- **Cách sửa**: Chuẩn hóa pattern "đổi nhãn nút + toast"; bọc `navigator.clipboard.writeText(...).catch(...)` và hiển thị lỗi.


---

### FE-45 — Form mở/đóng bằng nút "+ …" nhưng không có `aria-expanded`
- **Mức độ**: Low
- **Nhóm**: Accessibility / UX
- **Vị trí**: `popup.html:335` (`+ Thêm`), `362` (`+ Thêm hồ sơ`), `451` (`+ Lưu phiên`), `452` (`Nhập`)
```html
335:          <button id="btn-toggle-add-2fa" class="btn-text" type="button">+ Thêm</button>
362:          <button id="btn-toggle-add-card" class="btn-text" type="button">+ Thêm hồ sơ</button>
```
- **Tác động**: Các nút này toggle hiển thị `#card-add-2fa` (`popup.js:3132-3135`), `#card-add-card`, `#card-save-cookie-profile`, `#card-import-cookies` nhưng không thông báo trạng thái mở/đóng cho AT (`aria-expanded`, `aria-controls`).
- **Cách sửa**: Thêm `aria-expanded` + `aria-controls`; đổi nhãn khi đang mở (ví dụ "+ Thêm" ↔ "Đóng").

---

### FE-46 — Chuỗi hướng dẫn không khớp nhãn nút thực tế
- **Mức độ**: Info
- **Nhóm**: UX / Content
- **Vị trí**: `popup.js:2069` vs `popup.html:335`; `popup.js:3300` vs `popup.html:362`
```js
2069:      empty.textContent = 'Chưa có mã 2FA nào. Bấm "+ Thêm mã" để bắt đầu.';
3300:        : 'Chưa có thẻ thanh toán nào. Bấm "+ Thêm thẻ" để lưu thẻ mới.';
```
Nút thật là `"+ Thêm"` (`popup.html:335`) và `"+ Thêm hồ sơ"` (`popup.html:362`).
- **Cách sửa**: Đồng bộ chuỗi hướng dẫn với nhãn nút (và đưa vào từ điển i18n).

---

### FE-47 — Không cảnh báo khi "số tối thiểu" vượt quá "độ dài"
- **Mức độ**: Low
- **Nhóm**: UX
- **Vị trí**: `popup.html:185-189` (`#min-numbers`, `#min-special`), `popup.html:140` (`#length-range` min=5)
```html
185:              <input type="number" id="min-numbers" min="0" max="10" value="1">
189:              <input type="number" id="min-special" min="0" max="10" value="1">
```
- **Tác động**: Người dùng có thể đặt `min-numbers = 10` khi `length = 5` mà UI không cảnh báo; `#password-display` là `readonly` và **không có nút xóa/clear** (chỉ có refresh `#btn-refresh`). (Hành vi sinh mật khẩu khi cấu hình mâu thuẫn thuộc tầng logic — **ngoài phạm vi audit front-end này**, chưa kiểm chứng.)
- **Cách sửa**: Validate trực tiếp, hiển thị cảnh báo inline.

---

### FE-48 — Lỗi clipboard/lỗi nền chỉ ghi `console.warn`, không có bề mặt cho người dùng
- **Mức độ**: Info
- **Nhóm**: UX / Error surfacing
- **Vị trí**: `popup.js:980-982`, `popup.js:4016`, `popup.js:4225-4227`
```js
974:        const current = await navigator.clipboard.readText();
975:        if (current === text) {
976:          await navigator.clipboard.writeText("");
977:          showToast("Đã tự động xóa bộ nhớ tạm để bảo mật!");
...
980:      } catch (err) {
981:        console.warn("Clipboard auto-clear error:", err);
```
- **Tác động**: Nếu tính năng "tự xóa clipboard sau 30s" thất bại, người dùng **tin rằng clipboard đã được xóa** nhưng thực tế chưa — rủi ro bảo mật nhận thức. Không có cảnh báo.
- **Cách sửa**: Khi auto-clear thất bại, hiển thị toast cảnh báo "Không thể tự xóa clipboard — hãy xóa thủ công".


---

## F. Điểm tốt (điều đang làm đúng, nên giữ)

1. **An toàn DOM rất tốt**: Toàn bộ dữ liệu người dùng/kho (`site name`, `username`, `note`, số thẻ, cookie, tên 2FA) đều render qua `textContent`; chỉ 3 chỗ `innerHTML` có nội suy (`popup.js:1085, 1873, 1968`) và **tất cả** đều qua `escapeHtml`. Không có `eval`, `new Function`, `insertAdjacentHTML`, `outerHTML`, `document.write`, `javascript:` ở bất kỳ file nào ngoài vendor.
2. **Content script `content.js` escape đầy đủ** (`content.js:246, 250, 473, 475, 476, 481, 487, 493`) — đặc biệt quan trọng vì `domain` lấy từ URL trang web có thể bị kẻ tấn công kiểm soát.
3. **Không có inline event handler** trong `popup.html`; tất cả dùng `addEventListener` ⇒ tương thích CSP nghiêm ngặt (`manifest.json:7: "script-src 'self' 'wasm-unsafe-eval'"`).
4. **Mọi `<button>` đều có `type="button"`**; không có `<form>` ⇒ không có submit ngoài ý muốn.
5. **Đối chiếu ID HTML↔JS hoàn hảo**: 0 `id` trùng, 0 `getElementById` trỏ vào `null` (kiểm bằng script). Đây là điều nhiều codebase làm sai.
6. **i18n VI↔EN đối xứng hoàn toàn**: 80/80 khóa, không khóa nào lệch; 3 cặp giá trị trùng đều là danh từ riêng (GenPass/VietQR/PayPal).
7. **Thuộc tính `lang` được cập nhật động** (`popup.js:604`), không bị "đóng băng" ở `"vi"` như nhiều extension.
8. **Có hỗ trợ bàn phím cho một số luồng**: `Escape` đóng tất cả modal (`popup.js:2991-3007`); `Enter` gửi PIN vault (`popup.js:2691-2692`), `Enter/Escape` cho chỉnh sửa inline tên nhãn/tên phiên (`popup.js:1141-1143, 3945-3948`).
9. **Tự focus input khi mở form/modal** (nhiều vị trí: `popup.js:1349, 1412, 1498, 1505, 2978, 3135, 3500, 3609, 4038, 4115`) — giảm số lần tab.
10. **`!important` ở `popup.css` chỉ 4 lần** và đều phục vụ mục đích chính đáng (`[hidden]`, `.modal-backdrop[hidden]`, `.update-banner[hidden]`, `.vault-lock[hidden]`) — không có "cuộc chiến specificity".
11. **Không có CSS rule chết đáng kể**; dark mode được tổ chức bằng CSS variables (`popup.css:1-36`) — nền tảng tốt, chỉ cần phủ thêm.
12. **Scrollbar được tùy biến nhất quán** (`popup.css:57-74`, `174-186`) và thanh tab có cuộn ngang mượt + tự `scrollIntoView` tab đang chọn (`popup.js:3036-3042, 3067-3072`).
13. **Context menu trong `background.js` có song ngữ đầy đủ** và **tự cập nhật** khi người dùng đổi ngôn ngữ (qua `chrome.storage.onChanged`, `background.js:144-152`).
14. **Toast dùng `textContent`** (`popup.js:961`) ⇒ không có sink XSS qua thông báo dù nhiều toast chèn dữ liệu người dùng bằng template literal.
15. **CSP MV3 chặt** (`manifest.json:6-8`): không có `unsafe-inline`; `object-src 'self'`; chỉ nới `wasm-unsafe-eval` cho Argon2id (cần thiết cho `vendor/hash-wasm.umd.js`).


---

## G. Phụ lục — Bảng đối chiếu & tái lập kiểm chứng

Các lệnh đã dùng để sinh bằng chứng (chạy tại `/workspace`):

```bash
# 1) Đối chiếu ID HTML <-> JS
grep -oE 'id="[^"]+"' popup.html | sed 's/id="//;s/"//' | sort > /tmp/html_ids.txt
grep -oE 'getElementById\("[^"]+"\)' popup.js | grep -oE '"[^"]+"' | tr -d '"' | sort -u > /tmp/js_ids.txt
comm -23 /tmp/html_ids.txt /tmp/js_ids.txt     # id trong HTML không dùng
comm -13 /tmp/html_ids.txt /tmp/js_ids.txt     # id JS không có trong HTML
grep -oE 'id="[^"]+"' popup.html | sed 's/id="//;s/"//' | sort | uniq -d   # id trùng

# 2) Sink nguy hiểm
grep -rnE 'eval\(|new Function|insertAdjacentHTML|outerHTML|document\.write|javascript:' --include='*.js' --include='*.html' . | grep -v vendor/ | grep -v jsqr.js
grep -nE 'innerHTML|outerHTML|insertAdjacentHTML' popup.js

# 3) i18n
grep -oE 'data-i18n(-placeholder|-title)?="[^"]+"' popup.html | wc -l
grep -n 'toLocale.*vi-VN' popup.js content.js
grep -c 'showToast(' popup.js

# 4) CSS
grep -c '!important' popup.css content.css
grep -n 'z-index\|outline: none\|prefers-reduced-motion\|:focus-visible' popup.css
grep -oE '#[0-9a-fA-F]{3,8}\b' popup.css | wc -l

# 5) Xác nhận không có confirm()
grep -nE 'confirm\(|window\.confirm|alert\(' popup.js background.js content.js
```

**Bảng mức độ ưu tiên xử lý đề xuất (theo tác động):**

| Ưu tiên | ID | Lý do |
|---|---|---|
| 1 | FE-12 | Checkbox không dùng được bằng bàn phím/AT — ảnh hưởng toàn bộ tính năng tùy chỉnh |
| 2 | FE-41 | Mất dữ liệu vĩnh viễn không xác nhận (lịch sử, cookie) |
| 3 | FE-30, FE-31, FE-29 | i18n gần như không hoạt động dù tuyên bố "full i18n" |
| 4 | FE-32 | Bug thực tế phá icon khi đổi ngôn ngữ |
| 5 | FE-13 | Tương phản chữ dưới chuẩn ở light mode (2.45:1) |
| 6 | FE-01, FE-03, FE-04, FE-05 | Nền tảng accessibility (tab ARIA, label, control bàn phím) |
| 7 | FE-16, FE-42 | Toast bị che ⇒ mất phản hồi lỗi |
| 8 | FE-14, FE-15, FE-43 | Focus visible, reduced-motion, aria-live |
| 9 | FE-33..FE-39 | Hoàn thiện i18n |
| 10 | Còn lại | Vệ sinh/hiệu năng/bảo trì |

---

## H. Kết luận

- **XSS / DOM injection**: **Không phát hiện lỗ hổng khai thác được.** Không có `eval`/`new Function`/`document.write`; mọi `innerHTML` có nội suy đều dùng `escapeHtml`; dữ liệu người dùng đi qua `textContent`. Rủi ro còn lại chỉ ở mức Info (tải ảnh từ URL do trang kiểm soát — FE-26; thiếu `img-src` trong CSP).
- **Accessibility**: Đây là **điểm yếu lớn nhất**. Có 2 vấn đề High: checkbox bị `display:none` (FE-12) và tương phản chữ dưới chuẩn (FE-13); cùng một loạt vấn đề Medium (tab không có ARIA, thiếu label, control bàn phím, focus visible, reduced-motion, aria-live).
- **i18n**: Từ điển VI/EN đối xứng tốt nhưng **cơ chế áp dụng gần như không hoạt động** — chỉ 32/80 khóa được nối vào DOM, ~96 chuỗi HTML + ~90 toast vẫn hardcode tiếng Việt, và có bug thực tế xóa icon (FE-32). Tuyên bố "Full i18n" trong `task.md` **chưa đạt**.
- **HTML/CSS**: Markup cơ bản sạch (doctype, lang, không inline handler, không id trùng, ID↔JS khớp 100%); vấn đề chính là 6 thẻ `<main>`, `aria-label` hardcode, và ~91 màu hardcode ngoài biến.
- **UX**: Bổ sung xác nhận cho hành động phá hủy (FE-41) và sửa z-index toast (FE-16) là 2 việc có tác động lớn nhất với chi phí thấp.

> **Nhắc lại giới hạn**: Báo cáo dựa trên **phân tích tĩnh mã nguồn + script kiểm chứng**, chưa render popup thật trong Chrome và chưa chạy công cụ accessibility tự động. Các con số tương phản là tính toán theo công thức WCAG trên màu khai báo trong CSS. Khuyến nghị chạy lại bằng axe DevTools/Lighthouse trên popup đã build để xác nhận các mục accessibility trước khi sửa.

