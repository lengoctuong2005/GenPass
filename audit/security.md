# Báo cáo Kiểm toán Bảo mật & Quyền riêng tư — GenPass (Chrome MV3)

| Trường | Giá trị |
| :--- | :--- |
| **Đối tượng** | GenPass — Trình tạo mật khẩu & Kho mã hóa (Chrome Extension Manifest V3) |
| **Phiên bản** | `manifest.json` → `1.2.0` |
| **Commit** | `b4a9b7fdfd434f293ceed2367a19ed8cbdbf3066` (nhánh `main`) |
| **Ngày kiểm toán** | 2026-10-11 |
| **Phạm vi** | `manifest.json`, `background.js` (775 dòng), `content.js` (830 dòng), `vault.js` (183 dòng), `popup.js` (4349 dòng), `vendor/hash-wasm.umd.js`, `jsqr.js`, `wordlist.js` |
| **Phương pháp** | Đọc mã tĩnh (static review) + chạy thực nghiệm hàm `isSafeFetchUrl` bằng Node.js để xác minh bypass; đối chiếu chéo claim trong `README.md`/`task.md` với mã thực tế. Không sửa mã nguồn. |
| **Nguyên tắc** | Mọi phát hiện đều kèm bằng chứng `file:line` trích nguyên văn. Những điểm chưa chắc chắn được ghi rõ ở mục 8. |

> **Lưu ý về phương pháp luận:** Báo cáo ưu tiên các phát hiện *chứng minh được khả năng khai thác* (có bằng chứng chạy thực tế hoặc đường dẫn tấn công cụ thể). Các vấn đề chỉ mang tính phòng thủ chiều sâu (defense-in-depth) được ghi mức thấp hơn và ghi rõ điều kiện khai thác.

---

## 0. Tóm tắt điều hành

GenPass có nền tảng crypto tốt (Argon2id 64 MiB + AES-256-GCM + AAD, key `extractable=false`, IV/salt ngẫu nhiên) và tránh được nhiều lỗi kinh điển (không `eval`, không remote code, không bridge page↔extension, escape HTML tốt). Tuy nhiên báo cáo ghi nhận **nhiều lỗ hổng thực sự trong lớp kiểm soát SSRF** được quảng cáo là "chống tấn công SSRF", cùng với **bề mặt quyền hạn rất rộng** và **ranh giới tin cậy yếu giữa service worker và content script chạy trên mọi trang web**.

### Bảng tóm tắt phát hiện

| ID | Mức độ | Danh mục | Tóm tắt | Vị trí |
| :--- | :--- | :--- | :--- | :--- |
| **F-01** | **High** | SSRF | Bộ lọc bỏ sót IPv4-mapped IPv6 (`::ffff:127.0.0.1`, `::ffff:169.254.169.254`…) → bypass hoàn toàn | `background.js:264-293` |
| **F-02** | **High** | SSRF | Chặn sai dải ULA IPv6 `fc00::/7` (chỉ chặn đúng tiền tố `fc00:`/`fd00:`) | `background.js:288` |
| **F-03** | **High** | SSRF | Không xử lý HTTP redirect (`fetch` mặc định `follow`) → URL công khai 302 sang nội bộ | `background.js:296-299` |
| **F-04** | **High** | SSRF | Chỉ kiểm tra hostname dạng literal, không phân giải DNS → DNS rebinding / mọi domain trỏ về IP nội bộ đều lọt | `background.js:264-293` |
| **F-05** | **High** | SSRF | Popup tự fetch URL ảnh do trang web cung cấp **không qua bộ lọc SSRF** | `popup.js:907-957` |
| **F-06** | Medium | Kiến trúc/Tin cậy | `chrome.runtime.onMessage` không kiểm tra `sender`; `vault_get`/`vault_put`/`vault_lock` phục vụ mọi context gọi tới | `background.js:741-772` |
| **F-07** | Medium | Rò rỉ dữ liệu | Content script chạy trên **mọi** trang web, yêu cầu và giữ dữ liệu kho đã giải mã trong bộ nhớ | `content.js:57-79,139` |
| **F-08** | Medium | At-rest | Mặc định kho **không mã hóa**: mật khẩu, seed 2FA, số thẻ/CVV, cookie phiên lưu plaintext | `popup.js:1589`, `content.js:72` |
| **F-09** | Medium | Brute-force | Rate-limit PIN chỉ trong RAM popup, reset khi đóng popup; không ràng buộc ở tầng crypto | `popup.js:427-428,1404-1407` |
| **F-10** | Medium | Clipboard | Mật khẩu tạo từ menu chuột phải ghi vào clipboard nhưng **không** được tự xóa | `content.js:639` |
| **F-11** | Medium | QR/vault poisoning | Trang độc hại có thể nhúng `otpauth://` / ảnh QR để đầu độc kho 2FA | `background.js:632-657`, `content.js:722-760` |
| **F-12** | Medium | Permissions | `http://*/*` + `https://*/*` + `cookies` = đọc/ghi cookie mọi site, fetch mọi nơi | `manifest.json:17-28` |
| **F-13** | Low | Autofill | Khớp domain theo tên "mờ" (`domain.includes(name)`) có thể điền sai host | `content.js:146-150,659-663` |
| **F-14** | Low | Supply chain | Hash SHA-256 vendor ghi trong tài liệu **không khớp** file thực tế | `vault.js:8` |
| **F-15** | Low | Update | Tin version từ `raw.githubusercontent.com` không chữ ký; ping GitHub mỗi lần SW khởi động | `background.js:673-717,775` |
| **F-16** | Low | At-rest | `persist()` ghi plaintext khi vault bật nhưng đang khóa (đường dẫn tiềm ẩn) | `popup.js:1587-1591` |
| **F-17** | Low | DoS | `decodeQrFromUrl` không giới hạn kích thước/timeout ảnh tải về | `background.js:299-301` |
| **F-18** | Info | CSP/Manifest | Thiếu `minimum_chrome_version`; CSP thiếu một số directive hardening | `manifest.json:6-8` |
| **F-19** | Info | Cookie | Xuất/nhập cookie dạng JSON qua clipboard; nhập JSON có thể ghi cookie tùy ý | `popup.js:4126-4207` |
| **F-20** | Info | Crypto | Khóa AES (base64) lưu plaintext trong `storage.session`; KDF output dùng trực tiếp làm AES key | `background.js:346-362`, `popup.js:1242-1245` |

---

## 1. `manifest.json` — Phân tích quyền hạn tối thiểu, CSP và các khóa thiếu

### 1.1 Nội dung thực tế (nguyên văn)

```json
"permissions": [ "storage", "clipboardWrite", "activeTab", "contextMenus", "alarms", "cookies" ],
"host_permissions": [ "http://*/*", "https://*/*" ],
"content_security_policy": {
  "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
},
"content_scripts": [ { "matches": [ "http://*/*", "https://*/*" ],
  "js": [ "jsqr.js", "content.js" ], "css": [ "content.css" ], "run_at": "document_idle" } ]
```

### 1.2 Đối chiếu quyền ↔ tính năng (least privilege)

| Quyền | Có cần cho tính năng không? | Nhận xét |
| :--- | :--- | :--- |
| `storage` | Có (lưu lịch sử/2FA/thẻ/cookie/settings) | Hợp lý. |
| `clipboardWrite` | Có (nút sao chép) | Hợp lý, nhưng bị **lạm dụng** ở `content.js:639` (xem F-10). |
| `activeTab` | Có (chụp màn hình tab đang mở) | Hợp lý. |
| `contextMenus` | Có | Hợp lý. |
| `alarms` | Có (kiểm tra cập nhật 12h) | Hợp lý. |
| `cookies` | Có (trình quản lý phiên đăng nhập) | **Quyền rất mạnh**: đọc/ghi cookie của mọi site. |
| `host_permissions: http://*/*` + `https://*/*` | Một phần | Cần cho (a) `fetch()` ảnh QR cross-origin trong SW, (b) `chrome.cookies.getAll({url})` cho mọi site. Nhưng `http://*/*` (không TLS) là dư thừa — xem F-12. |

**Kết luận:** Tổ hợp `cookies` + `http://*/*` + `https://*/*` cho phép tiện ích đọc/ghi **toàn bộ cookie của mọi website** và `fetch` tới **mọi host**. Đây là mức đặc quyền rất cao so với một "password generator". Nó *được biện minh* bởi tính năng "Quản lý Cookies & Chuyển phiên" (README dòng 23), nhưng người dùng không được cảnh báo rõ khi cài đặt, và bất kỳ lỗi nào trong SW/popup đều có thể bị lợi dụng để trích xuất toàn bộ phiên đăng nhập.

### 1.3 CSP — đánh giá

- `script-src 'self' 'wasm-unsafe-eval'` — **Tốt**: chỉ cho script nội bộ; `wasm-unsafe-eval` là bắt buộc để chạy Argon2id WebAssembly (`vendor/hash-wasm.umd.js`) trong MV3. **Không** có `'unsafe-inline'`, **không** có nguồn remote → đúng chuẩn.
- `object-src 'self'` — Tốt (MV3 mặc định chặn plugin).
- **Thiếu (hardening, không phải lỗ hổng):** `default-src 'none'`, `base-uri 'none'`, `form-action 'none'`, `frame-ancestors 'none'`. Xem **F-18**.

### 1.4 Các khóa thiếu

| Khóa | Có mặt? | Đánh giá |
| :--- | :--- | :--- |
| `web_accessible_resources` | **Không** | ✅ **Tốt** — tài nguyên tiện ích (vd `jsqr.js`, `vault.js`) không bị lộ cho trang web đọc. Không có tính năng nào cần. |
| `externally_connectable` | **Không** | ✅ **Tốt** — chặn trang web/extension khác gửi `runtime.sendMessage` tới SW. Đây là yếu tố giảm nhẹ quan trọng cho F-06. |
| `minimum_chrome_version` | **Không** | ⚠️ F-18 — code dùng `chrome.storage.session.setAccessLevel` (Chrome ≥102), `OffscreenCanvas` trong SW, `createImageBitmap`. Thiếu khai báo → hành vi không xác định trên Chrome cũ. |
| `sandbox` | Không | Không cần. |
| `optional_host_permissions` | Không | Nên dùng để thu hẹp `host_permissions` (F-12). |
| `all_frames` (trong content_scripts) | Không khai báo → mặc định `false` | ✅ **Tốt**: content script **chỉ chạy ở top frame**. Điều này giảm nhẹ rủi ro iframe (xem mục 3.4). |


### F-12 — [Medium] `host_permissions` + `cookies` quá rộng so với tính năng

- **Mức độ:** Medium
- **Danh mục:** Permissions / Least privilege
- **Vị trí:** `manifest.json:17-28`

**Bằng chứng (nguyên văn):**
```json
"permissions": [ "storage", "clipboardWrite", "activeTab", "contextMenus", "alarms", "cookies" ],
"host_permissions": [ "http://*/*", "https://*/*" ]
```
- `cookies` + `http(s)://*/*` cho phép đọc/ghi **cookie của mọi website** (`popup.js:4070,4199,4013,4163`), tức là toàn bộ **phiên đăng nhập** (session token).
- `host_permissions` bao gồm cả `http://*/*` (không TLS), trong khi tính năng QR chỉ cần fetch ảnh; `img.vietqr.io` là HTTPS.
- `activeTab` **dư thừa** khi đã có `host_permissions` phủ mọi site.

**Tác động:** Bề mặt đặc quyền rất lớn cho một "password generator". Nếu SW/popup bị lỗi (hoặc một dependency bị chèn), attacker đọc được cookie của mọi site (chiếm phiên) và fetch tới mọi host (SSRF). Người dùng cũng không thấy cảnh báo giải thích vì sao cần quyền đọc cookie.

**Khuyến nghị:**
- Bỏ `http://*/*` nếu chỉ dùng cho QR; chuyển sang `optional_host_permissions` + xin quyền theo nhu cầu (`chrome.permissions.request`).
- Với tính năng cookie, xin quyền host **theo site đang mở** thay vì `*://*/*`.
- Cân nhắc tách tính năng "Quản lý cookie" thành quyền tùy chọn (optional) mà người dùng bật riêng.
- Ghi rõ lý do từng quyền trong trang mô tả tiện ích (README đã có mục Quyền hạn nhưng chưa nhấn mạnh hệ quả của `cookies`).


---

## 2. `background.js` — Service Worker (SSRF, tin cậy sender, vault, update, context menus)

### 2.0 Bộ lọc SSRF `isSafeFetchUrl` — đọc chính xác

```js
// background.js:264-293
function isSafeFetchUrl(urlStr) {
  if (!urlStr || typeof urlStr !== "string") return false;
  const s = urlStr.trim();
  if (s.startsWith("data:") || s.startsWith("blob:")) return true;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host === "0.0.0.0" || host.endsWith(".local") ||
        host.endsWith(".localhost") || host.endsWith(".internal")) return false;
    if (/^127\./.test(host)) return false;
    if (/^10\./.test(host)) return false;
    if (/^192\.168\./.test(host)) return false;
    if (/^169\.254\./.test(host)) return false;
    if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)) return false;
    if (host === "::1" || host === "[::1]") return false;
    if (host.startsWith("fe80:") || host.startsWith("[fe80:")) return false;
    if (host.startsWith("fc00:") || host.startsWith("[fc00:") || host.startsWith("fd00:") || host.startsWith("[fd00:")) return false;
    return true;
  } catch { return false; }
}
```

**Điểm làm đúng (đã kiểm chứng bằng cách chạy thực tế):** URL parser chuẩn hóa IPv4 dạng hex/octal/thập phân về dotted-quad, nên các biến thể kinh điển bị chặn: `http://0x7f.0.0.1/`, `http://0177.0.0.1/`, `http://2130706433/`, `http://0x7f000001/` đều **BLOCK**. Uppercase (`LOCALHOST`) và dấu chấm cuối (`127.0.0.1.`) cũng bị chặn do parser normalize. `javascript:`, `ftp:` bị chặn. `userinfo` kiểu `http://user@127.0.0.1/` bị chặn (hostname = `127.0.0.1`).

**Điểm làm sai (bằng chứng chạy thực tế — xem Phụ lục A):**

| Input | Kết quả | Ghi chú |
| :--- | :--- | :--- |
| `http://[::ffff:127.0.0.1]/` | **ALLOW** ❌ | IPv4-mapped IPv6 loopback |
| `http://[::ffff:169.254.169.254]/` | **ALLOW** ❌ | IPv4-mapped cloud metadata |
| `http://[::ffff:10.0.0.5]/` | **ALLOW** ❌ | IPv4-mapped RFC1918 |
| `http://[fc01::1]/`, `[fcff::1]`, `[fdff::1]` | **ALLOW** ❌ | ULA `fc00::/7` (bug tiền tố) |
| `http://100.64.0.1/` | **ALLOW** ❌ | CGNAT `100.64.0.0/10` |
| `http://192.0.0.1/` | **ALLOW** ❌ | `192.0.0.0/24` |
| `http://localtest.me/`, `http://foo.127.0.0.1.nip.io/` | **ALLOW** ❌ | DNS rebinding |
| `http://kubernetes.default.svc/` | **ALLOW** ❌ | DNS nội bộ không có `.internal` |

---


### F-01 — [High] SSRF bypass qua IPv4-mapped IPv6 (`::ffff:…`)

- **Mức độ:** High
- **Danh mục:** SSRF / Network
- **Vị trí:** `background.js:264-293` (thiếu xử lý tiền tố `::ffff:` / `64:ff9b::`)

**Bằng chứng (chạy thực tế với chính hàm trong `background.js`):**
```
ALLOW  http://[::ffff:127.0.0.1]/          hostname=[::ffff:7f00:1]
ALLOW  http://[::ffff:169.254.169.254]/    hostname=[::ffff:a9fe:a9fe]
ALLOW  http://[::ffff:192.168.1.1]/        hostname=[::ffff:c0a8:101]
ALLOW  http://[::ffff:10.0.0.5]/           hostname=[::ffff:a00:5]
```
Code chỉ kiểm tra `host === "[::1]"` và `startsWith("[fe80:")`/`"[fc00:")`/`"[fd00:")`; **không** có nhánh nào cho `::ffff:` (IPv4-mapped) hay `64:ff9b::/96` (NAT64). URL parser giữ nguyên dạng `[::ffff:7f00:1]`, nên regex `/^127\./` không khớp.

**Kịch bản tấn công:** Trang độc hại nhúng `<img src="http://[::ffff:169.254.169.254]/latest/meta-data/">`. Người dùng bấm chuột phải → "GenPass → Quét QR 2FA → Quét từ ảnh này" (`background.js:488-494`). SW gọi `decodeQrFromUrl(info.srcUrl)` → `fetch()` từ **origin tiện ích có `host_permissions: http://*/*`** → request tới loopback/RFC1918/link-local, **bỏ qua bộ lọc**. Đây là SSRF mù (response đưa vào `createImageBitmap`/`jsQR`, không trả thẳng cho attacker), nhưng vẫn dùng được để dò cổng nội bộ và kích hoạt GET tới endpoint nội bộ. Lưu ý: `fetch` mặc định `credentials: "same-origin"` nên cookie người dùng **không** được gửi kèm cross-origin — giảm nhẹ tác động.

**Khuyến nghị:** Sau khi lấy `hostname`, tháo bracket và chuẩn hóa về IPv4/IPv6 thuần; từ chối mọi địa chỉ trong dải riêng tư/đặc biệt gồm `::ffff:0:0/96`, `64:ff9b::/96`, `fc00::/7`, `fe80::/10`, `::1/128`, `::/128`. Tốt nhất dùng thư viện chuẩn hóa IP (vd `ipaddr.js`) và so khớp theo **dải CIDR** thay vì `startsWith`.

```js
const ip = normalizeIp(host.replace(/^\[|\]$/g, ""));
if (ip && (ip.kind() === "ipv6" ? isPrivateV6(ip) : isPrivateV4(ip))) return false;
// isPrivateV4: 0.0.0.0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12,
//               192.0.0/24, 192.168/16, 198.18/15, 224/4, 240/4
// isPrivateV6: ::1, ::, fc00::/7, fe80::/10, ::ffff:0:0/96 (đệ quy v4), 64:ff9b::/96
```

---

### F-02 — [High] SSRF: chặn sai dải IPv6 ULA `fc00::/7`

- **Mức độ:** High
- **Danh mục:** SSRF / Network
- **Vị trí:** `background.js:288`

**Bằng chứng:** `background.js:288`
```js
if (host.startsWith("fc00:") || host.startsWith("[fc00:") || host.startsWith("fd00:") || host.startsWith("[fd00:")) return false;
```
`fc00::/7` bao trùm toàn bộ `fc00:`–`fdff:`. Điều kiện chỉ khớp **đúng** tiền tố `fc00:`/`fd00:`, nên `[fc01::1]`, `[fcff::1]`, `[fd12::1]`, `[fdff::1]` đều **ALLOW** (đã chạy thực tế — Phụ lục A).

**Tác động:** Kết nối tới địa chỉ ULA nội bộ (mạng IPv6 doanh nghiệp/VPN) bị bỏ qua — vô hiệu hóa mục tiêu "chặn dải mạng LAN riêng tư" mà README dòng 188 khẳng định.

**Khuyến nghị:** So khớp theo dải `/7`: parse byte đầu của IPv6, chặn khi `(firstByte & 0xfe) === 0xfc`.

---

### F-03 — [High] SSRF: không chặn HTTP redirect

- **Mức độ:** High
- **Danh mục:** SSRF / Network
- **Vị trí:** `background.js:296-301`

**Bằng chứng:**
```js
async function decodeQrFromUrl(url) {
  if (!isSafeFetchUrl(url)) return null;
  try {
    const response = await fetch(url);          // <-- KHÔNG có { redirect: "manual" }
    const blob = await response.blob();
```
`fetch()` mặc định `redirect: "follow"` (tối đa 20 hop). Bộ lọc chỉ kiểm tra URL **ban đầu**; URL sau redirect không được kiểm lại.

**Kịch bản tấn công:** Attacker đặt `<img src="https://attacker.example/r.png">`; URL này trả `302 Location: http://169.254.169.254/latest/meta-data/`. `isSafeFetchUrl("https://attacker.example/r.png")` trả `true` → `fetch` tự đi theo redirect tới metadata → **bỏ qua toàn bộ bộ lọc SSRF**. Đây là cách vượt guard hiệu quả nhất vì không cần dạng IP lạ.

**Khuyến nghị:** Dùng `fetch(url, { redirect: "manual", credentials: "omit", signal: AbortSignal.timeout(5000) })` và tự xử lý `Location` (kiểm lại `isSafeFetchUrl` trên từng hop), hoặc từ chối mọi redirect.

---

### F-04 — [High] SSRF: chỉ kiểm tra hostname literal, không phân giải DNS (DNS rebinding)

- **Mức độ:** High
- **Danh mục:** SSRF / Network
- **Vị trí:** `background.js:264-293`

**Bằng chứng:** Hàm chỉ nhìn `u.hostname`. Không có bước resolve DNS và kiểm tra IP đích.

**Kịch bản tấn công:** Attacker dùng domain trỏ về IP nội bộ:
- `http://localtest.me/` → **ALLOW** (trỏ về `127.0.0.1`)
- `http://foo.127.0.0.1.nip.io/` → **ALLOW**
- Domain riêng của attacker có A record `10.0.0.5`, hoặc DNS rebinding.
- `http://kubernetes.default.svc/`, `http://metadata/` → **ALLOW** (không có `.internal`).

**Khuyến nghị:** Không thể chống DNS rebinding hoàn toàn ở tầng JS; nên (a) **allowlist** hostname tin cậy cho tính năng QR thay vì blocklist, hoặc (b) fetch qua proxy nội bộ, hoặc (c) resolve DNS và kiểm tra IP trước khi kết nối (vẫn còn khe TOCTOU). Tối thiểu: chặn hậu tố rebinding phổ biến + dùng `redirect: "manual"`.


---

### F-05 — [High] Popup tự fetch URL ảnh do trang web cung cấp, KHÔNG qua bộ lọc SSRF

- **Mức độ:** High
- **Danh mục:** SSRF / Network
- **Vị trí:** `popup.js:907-957` (hàm `tryScanFromActiveTab`)

**Bằng chứng:** Popup yêu cầu content script liệt kê ứng viên QR của trang (`popup.js:920`), rồi **tự nạp ảnh bằng `<img>`** cho từng URL do trang cung cấp:
```js
// popup.js:936-946
const candidates = Array.isArray(response.candidates) ? response.candidates : [];
for (const candidateSrc of candidates) {
  const res = await new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = async () => { const qr = await decodeQrFromImage(img); resolve(qr); };
    img.onerror = () => resolve(null);
    img.src = candidateSrc;        // <-- URL do trang web kiểm soát, không kiểm SSRF
  });
```
Các ứng viên đến từ `content.js:722-760` — bao gồm `img.currentSrc`/`img.src` của **mọi ảnh trên trang** và `canvas.toDataURL()`. Popup **không** import `isSafeFetchUrl` (hàm này chỉ tồn tại trong `background.js`). Cùng với `host_permissions` rộng, popup có thể phát request tới host bất kỳ.

**Kịch bản tấn công:** Trang độc hại chèn `<img src="http://[::ffff:169.254.169.254]/...">` (hoặc `http://192.168.1.1/...`, `http://[fd12::1]/...`). Người dùng mở popup → tab 2FA → "Quét toàn trang/màn hình". Popup lần lượt nạp các ảnh → phát request SSRF từ origin tiện ích. Do `crossOrigin="anonymous"` + canvas, nội dung response **không** đọc được nếu server nội bộ không bật CORS (canvas bị "tainted", `getImageData` ném lỗi, được `catch`) → đây là **SSRF mù + CSRF GET**, vẫn đủ để dò cổng/endpoint nội bộ.

**Khuyến nghị:** Áp dụng cùng một hàm `isSafeFetchUrl` (đã vá theo F-01..F-04) cho mọi `candidateSrc` trước khi nạp; ưu tiên chuyển việc fetch ảnh vào SW (nơi có thể dùng `redirect: "manual"`), hoặc dùng `chrome.tabs.captureVisibleTab` (ảnh do tiện ích tự chụp, không do trang kiểm soát). Đồng thời giới hạn `candidates` chỉ nhận `data:`/`blob:` và host same-origin với trang.

---

### F-06 — [Medium] `onMessage` không kiểm tra `sender`; phơi bày `vault_get`/`vault_put`/`vault_lock`

- **Mức độ:** Medium (defense-in-depth; xem phân tích khả năng khai thác)
- **Danh mục:** Trust boundary / Authorization
- **Vị trí:** `background.js:741-772`

**Bằng chứng (nguyên văn):**
```js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.action) return;
  if (msg.action === "vault_lock") { chrome.storage.session.remove("genVaultKey"); sendResponse({ ok: true }); return; }
  if (msg.action === "vault_state") { ... }
  if (msg.action === "vault_get") { vaultRead(msg.keys).then(sendResponse); return true; }
  if (msg.action === "vault_put") { vaultMutate(msg.items || {}).then(...); return true; }
});
```
Tham số `sender` **được khai báo nhưng không bao giờ dùng**. `vaultRead` (`background.js:391-401`) trả về dữ liệu đã giải mã cho **bất kỳ** `msg.keys` nào, không allowlist. `vaultMutate` (`background.js:372-388`) cho phép ghi/ghi đè kho tùy ý.

**Trả lời trực tiếp câu hỏi "content script trên một website bất kỳ có gọi được vault_get/vault_put/vault_lock không?":**
- **JS của trang web KHÔNG thể** gọi trực tiếp: trang không có `chrome.runtime.sendMessage`, và `manifest.json` **không** khai báo `externally_connectable` → không có `onMessageExternal`. Đây là điểm giảm nhẹ quan trọng.
- **Content script của chính GenPass (chạy trên MỌI trang http/https) THÌ CÓ** — và SW phục vụ nó vô điều kiện. Tức là mọi context trong tiện ích đều được coi là "tin cậy tuyệt đối".

**Vì sao vẫn đáng vá (Medium):** Ranh giới tin cậy duy nhất bảo vệ kho là "content script không bị lỗi". Bất kỳ XSS/DOM-clobbering/prototype-pollution nào trong content script, hoặc một bridge `postMessage` thêm vào sau này, sẽ biến thành **trích xuất toàn bộ kho** (mật khẩu, seed TOTP, số thẻ) không cần thêm bước nào. Kiểm soát theo `sender` + allowlist key loại bỏ hẳn lớp rủi ro này.

**Khuyến nghị:**
```js
const fromSelf = sender?.id === chrome.runtime.id;              // bắt buộc
const isExtensionPage = fromSelf && (sender.url || "").startsWith(chrome.runtime.getURL(""));
if (msg.action.startsWith("vault_")) {
  if (!fromSelf) return;                                       // chặn mọi nguồn ngoài
  if (msg.action !== "vault_lock" && !isExtensionPage) return; // vault_get/put chỉ cho popup/tab tiện ích
}
```
Đồng thời allowlist `keys` trong `vaultRead` (chỉ `["genOptions","genHistory","gen2FA","genCards","genTags"]`), và cân nhắc không cho content script đọc `gen2FA`/`genHistory` đầy đủ nếu không cần (xem F-07).


### 2.1 `vaultContext` / `vaultRead` / `vaultMutate` và khóa phiên

**Bằng chứng — `vaultContext` (`background.js:340-369`):**
```js
const sess = await chrome.storage.session.get("genVaultKey");
const entry = sess.genVaultKey;
if (!entry) { ctx.locked = true; return ctx; }
const keyB64 = typeof entry === "string" ? entry : entry && entry.k;
if (entry && entry.exp && Date.now() > entry.exp) { await chrome.storage.session.remove("genVaultKey"); ctx.locked = true; return ctx; }
try { ctx.key = keyB64; ctx.data = await GPVault.decryptBlob(plain.genVault, keyB64); }
catch (err) { console.warn("Kho khong giai mai duoc (doi PIN?):", err); ctx.locked = true; }
```
- **Tích cực:** `chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })` được đặt tường minh (`background.js:27-32`) → content script **không** đọc trực tiếp được `genVaultKey`.
- **Hạn chế:** Khóa AES **thô dạng base64** (`keyB64`) nằm plaintext trong `storage.session` (chỉ RAM, mất khi tắt trình duyệt) — chấp nhận được, nhưng xem **F-20**. Mỗi lần `vaultRead` đều giải mã **toàn bộ blob** trong SW (không cache) → content script gọi trên mỗi trang đều tốn AES-GCM decrypt và copy dữ liệu nhạy cảm vào RAM SW.

**`vaultRead` (`background.js:391-401`)** — trả về đúng các key được yêu cầu, không allowlist:
```js
const list = Array.isArray(keys) ? keys : [];
const ctx = await vaultContext();
if (ctx.locked) return { __locked: true };
list.forEach(k => { if (ctx.vault && ctx.data && Object.prototype.hasOwnProperty.call(ctx.data, k)) out[k] = ctx.data[k];
                    else if (Object.prototype.hasOwnProperty.call(ctx.plain, k)) out[k] = ctx.plain[k]; });
```
Dùng `hasOwnProperty` nên an toàn với prototype pollution ở bước đọc (tốt). Nhưng `list` không giới hạn.

**`vaultMutate` (`background.js:372-388`)** — ghi đè toàn bộ `ctx.data` bằng `Object.assign` rồi `reencrypt` lại; không có kiểm tra toàn vẹn/rollback ngoài GCM tag. Bất kỳ caller nào cũng ghi được (xem F-06).

### 2.2 Port `"vault-session"` — hành vi tự khóa

**Bằng chứng (`background.js:719-738`):**
```js
let vaultPortCount = 0;
chrome.runtime.onConnect.addListener((port) => {
  if (!port || port.name !== "vault-session") return;
  vaultPortCount++;
  port.onDisconnect.addListener(async () => {
    vaultPortCount = Math.max(0, vaultPortCount - 1);
    if (vaultPortCount > 0) return;
    const { genOptions } = await chrome.storage.local.get("genOptions");
    if (genOptions && genOptions.vaultLockClose) { await chrome.storage.session.remove("genVaultKey"); }
  });
});
```
- **Tích cực:** Đếm port xử lý đúng trường hợp nhiều popup/side-panel; không dựa vào tác vụ bất đồng bộ của popup (vốn bị hủy khi popup đóng).
- **Hạn chế:** Không kiểm tra `port.sender`. Bất kỳ context nào cũng mở được port tên `"vault-session"` → có thể *tăng* `vaultPortCount` để **ngăn** tự khóa (kéo dài thời gian khóa phiên sống). Mức: Low. Khuyến nghị: xác thực `port.sender.id === chrome.runtime.id` và URL là trang tiện ích.

### 2.3 Kiểm tra cập nhật từ `raw.githubusercontent.com`

**Bằng chứng (`background.js:673-717`, `775`):**
```js
const res = await fetch("https://raw.githubusercontent.com/lengoctuong2005/GenPass/main/manifest.json?t=" + Date.now(), { cache: "no-store" });
...
if (remote?.version) { const hasUpdate = compareVersions(remote.version, localVersion) > 0;
  if (hasUpdate) { chrome.action.setBadgeText({text:"NEW"}); chrome.storage.local.set({ genUpdateInfo: {...} }); } }
...
checkForUpdates();   // background.js:775 — chạy mỗi lần SW được nạp
```
- **Đánh giá:** Không chữ ký/kiểm tra toàn vẹn; tin tưởng version từ nhánh `main`. Version chỉ dùng hiện badge + banner (`popup.js:2578-2602`) và nút mở `https://github.com/lengoctuong2005/GenPass` (`popup.js:2628-2634`). Nội dung hiển thị qua `textContent` (không XSS). HTTPS nên MITM khó, nhưng nếu repo/asset GitHub bị chiếm, attacker có thể đẩy banner "có bản mới" dụ cài bản độc hại. **F-15 (Low).**
- **Quyền riêng tư:** `checkForUpdates()` chạy ở top-level SW (`:775`) + `onStartup` + alarm 720 phút → SW thức dậy rất thường xuyên sẽ ping GitHub, để lộ *thời điểm* sử dụng tiện ích (rò rỉ metadata). Thêm `?t=Date.now()` phá cache → tăng số request. Đối chiếu README dòng 185 "100% Ngoại tuyến (Zero Telemetry)" — claim này **không chính xác tuyệt đối**: có 2 endpoint remote (GitHub raw + `img.vietqr.io` ở `popup.js:422,647`).
### F-15 — [Low] Tin tưởng version từ GitHub không chữ ký + ping mạng mỗi lần SW khởi động

- **Mức độ:** Low
- **Danh mục:** Update integrity / Privacy
- **Vị trí:** `background.js:673-717`, `background.js:775`

**Bằng chứng:**
```js
// background.js:675
const res = await fetch("https://raw.githubusercontent.com/lengoctuong2005/GenPass/main/manifest.json?t=" + Date.now(), { cache: "no-store" });
// background.js:711-716
chrome.runtime.onStartup.addListener(checkForUpdates);
if (chrome.alarms) { chrome.alarms.create("check_update_alarm", { periodInMinutes: 720 });
  chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === "check_update_alarm") checkForUpdates(); }); }
// background.js:775
checkForUpdates();
```
- Version remote **không được xác thực chữ ký/hash**; chỉ so sánh số phiên bản. Nếu repo GitHub bị chiếm (hoặc có kẻ kiểm soát `main`), kẻ tấn công đẩy banner "có bản mới" (`popup.js:2578-2602`) và người dùng có thể bị dụ cài bản độc hại từ nguồn giả.
- `checkForUpdates()` chạy ở **top-level SW** (`:775`) → mỗi lần SW được đánh thức (rất thường xuyên trong MV3) đều có khả năng ping GitHub; cộng thêm `?t=Date.now()` phá cache làm tăng số request. Đây là **rò rỉ metadata** (thời điểm/ tần suất dùng tiện ích) ra bên thứ ba, mâu thuẫn với claim "Zero Telemetry" (README dòng 185).

**Khuyến nghị:** Ký số metadata cập nhật (hoặc dùng endpoint chính thức của Chrome Web Store) và xác minh trước khi hiển thị; chỉ kiểm tra ở `onInstalled`/`onStartup` thay vì mỗi lần nạp SW; bỏ cache-buster; ghi rõ trong README rằng có kết nối tới GitHub/VietQR.

### 2.4 Context menus — rò rỉ thông tin?

- Menu tạo song ngữ VI/EN (`background.js:35-135`), **không** nhúng dữ liệu người dùng vào tiêu đề → **không** rò rỉ secret qua menu.
- `fill_latest_2fa` (`background.js:577-623`) khớp domain **mờ**: `item.name.toLowerCase().includes(domain) || domain.includes(item.name.toLowerCase())` → có thể chọn sai mục 2FA (liên quan F-13).

### 2.5 `chrome.tabs.sendMessage` tới frame tùy ý

- Nhiều lời gọi không chỉ định `frameId` (`background.js:479, 489, 522, 573, 618`). Trong MV3, `tabs.sendMessage` không có `frameId` gửi tới **tất cả frame** có content script.
- **Giảm nhẹ thực tế:** `manifest.json` không đặt `all_frames: true` → content script **chỉ** tồn tại ở top frame, nên thực tế chỉ top frame nhận. Nếu sau này bật `all_frames`, việc gửi `fill_2fa`/`fill_generated_password` tới mọi frame sẽ là rủi ro (OTP/mật khẩu đi vào iframe khác origin). Content script đã có guard top-frame cho `fill_2fa` (`content.js:768-772`) nhưng **không** cho `fill_generated_password` (`content.js:628-653`) hay `trigger_autofill_creds` (`content.js:655-693`).
- **Khuyến nghị:** chỉ định `{ frameId: 0 }` cho các message điền dữ liệu nhạy cảm.


---

## 3. `content.js` — Content Script (chạy trên MỌI trang http/https)

### 3.1 Kiểm tra `sender` trong message listener

**Bằng chứng (`content.js:621`):**
```js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "show_toast" && msg.message) { ... }
  if (msg.action === "fill_generated_password" && msg.password) { ... }
  if (msg.action === "trigger_autofill_creds") { ... }
  if (msg.action === "decode_image_element" && msg.srcUrl) { ... }
  if (msg.action === "find_page_qr_candidates") { ... }
  if (msg.action === "fill_2fa" && msg.code) { ... }
});
```
`sender` **không được kiểm tra**. Trong Chrome, content script chỉ nhận message từ extension của chính nó (trang web không thể `tabs.sendMessage`), nên **không có đường tấn công trực tiếp từ trang**. Tuy nhiên, giống F-06, đây là thiếu sót phòng thủ chiều sâu: nên thêm `if (sender?.id !== chrome.runtime.id) return;`. Mức: Low/Info.

### F-07 — [Medium] Content script chạy trên mọi trang và giữ dữ liệu kho đã giải mã

- **Mức độ:** Medium
- **Danh mục:** Rò rỉ dữ liệu / Bề mặt tấn công
- **Vị trí:** `content.js:57-79` (`gpGet`/`gpSet`), `content.js:139` (`initAutoFillBadges`), `content.js:290,430,514,656`

**Bằng chứng:**
```js
// content.js:57-67
function gpGet(keys, cb) {
  chrome.storage.local.get(["genOptions"], (o) => {
    if (!vaultEnabled(o)) { chrome.storage.local.get(keys, cb); return; }
    chrome.runtime.sendMessage({ action: "vault_get", keys: keys }, (res) => {
      cb(res && res.__locked ? {} : (res || {}));
    });
  });
}
// content.js:139 — chạy ngay khi DOM idle trên MỌI trang
gpGet(["genOptions", "genHistory"], (res) => { ... const matching = history.filter(...); ... });
```
Content script gọi `vault_get` để lấy `genHistory` (chứa **mật khẩu plaintext**) ngay khi trang load, trên **mọi** website (kể cả trang độc hại). Dữ liệu nằm trong isolated world nên JS của trang không đọc trực tiếp — đây là điểm cộng — nhưng:
1. Bất kỳ lỗi injection nào trong content script (kể cả từ dữ liệu trang đưa vào) sẽ lộ kho.
2. Dữ liệu nhạy cảm bị giải mã và đưa ra khỏi SW cho mọi tab, không cần thiết — chỉ nên lấy khi người dùng chủ động autofill.

**Khuyến nghị:** Không gọi `vault_get` chủ động khi load trang. Chỉ hỏi "có bản ghi nào cho host này không?" và SW trả về **danh sách username/khớp host**, tuyệt đối không trả `password`/`secret` cho tới khi người dùng bấm autofill. Thêm allowlist key (F-06).

### F-10 — [Medium] Mật khẩu tạo từ menu chuột phải ghi vào clipboard nhưng KHÔNG tự xóa

- **Mức độ:** Medium
- **Danh mục:** Clipboard exposure
- **Vị trí:** `content.js:638-642`; cơ chế tự xóa chỉ có ở `popup.js:966-980`

**Bằng chứng:**
```js
// content.js:638-642
try {
  navigator.clipboard.writeText(msg.password);
} catch (err) { console.warn("Clipboard write failed:", err); }
```
```js
// popup.js:966-980 — scheduleClipboardClear chỉ tồn tại trong popup
function scheduleClipboardClear(text, seconds = 30) {
  if (!els.optAutoClearClipboard || !els.optAutoClearClipboard.checked || !text) return;
  ...
}
```
Luồng tạo mật khẩu qua **menu chuột phải** (`background.js:478-484` → `content.js:628-653`) **luôn** ghi mật khẩu vào clipboard, kể cả khi đã điền vào ô nhập (`content.js:644-651`). Vì `scheduleClipboardClear` chỉ được gọi trong popup, mật khẩu tạo qua menu chuột phải **nằm lại vĩnh viễn** trong clipboard.

**Tác động:** Mật khẩu còn trong clipboard có thể bị ứng dụng khác đọc, bị dán nhầm vào trang/chat, hoặc bị đọc khi clipboard đồng bộ qua mạng.

**Khuyến nghị:** Không ghi clipboard khi đã điền thành công vào ô nhập; nếu vẫn ghi (không tìm thấy ô), yêu cầu SW đặt hẹn xóa (dùng `alarms`) hoặc thực hiện copy + hẹn xóa ở phía popup/SW thay vì content script (vốn không có timer bền vững khi tab bị đóng).


### F-11 — [Medium] QR scan có thể bị "đầu độc" kho 2FA (vault poisoning)

- **Mức độ:** Medium
- **Danh mục:** Data integrity / Phishing
- **Vị trí:** `background.js:626-657` (`processQrResult`/`save2FaCredential`), `content.js:722-760` (`find_page_qr_candidates`)

**Bằng chứng:** `content.js:725-731` trả về **mọi** link `otpauth://` tìm thấy trong DOM trang:
```js
const links = Array.from(document.querySelectorAll('a[href^="otpauth://"], [data-url^="otpauth://"], [data-uri^="otpauth://"]'));
for (const link of links) {
  const href = link.getAttribute("href") || link.getAttribute("data-url") || link.getAttribute("data-uri");
  if (href && href.startsWith("otpauth://")) { sendResponse({ otpUrl: href }); return true; }
}
```
`background.js:632-657` nhận text QR, parse `otpauth://`, rồi **tự động lưu** vào kho:
```js
if (trimmed.startsWith("otpauth://")) { const parsed = parseOtpAuthUrl(trimmed); if (parsed && parsed.secret) { ... secret = parsed.secret; } }
...
save2FaCredential(name, account, secret, tabId).catch(...)
```
Và `save2FaCredential` đẩy mục mới lên đầu: `list.unshift(newItem)` (`background.js:429`).

**Kịch bản tấn công:** Trang độc hại nhúng `<a href="otpauth://totp/Evil?secret=ATTACKERSECRET">` (ẩn) hoặc một ảnh QR. Người dùng mở popup/chuột phải → "Quét toàn trang" → tiện ích **lưu secret của attacker** vào kho (thành mục "mới nhất"). Sau đó, khi người dùng dùng "Điền mã OTP mới nhất", mã OTP do attacker kiểm soát sẽ được điền → mầm mống 2FA-bypass/phishing. Tối thiểu là **DoS/đầu độc dữ liệu**.

**Khuyến nghị:** Yêu cầu người dùng xác nhận trước khi lưu (không auto-save); chỉ nhận `otpauth://` từ ảnh do người dùng chọn (file/kéo thả) hoặc từ `captureVisibleTab`, không tự động tin link trong DOM; không `unshift` mục mới lên đầu "mới nhất" mà không xác nhận.

### F-13 — [Low] Khớp domain "mờ" khi autofill có thể điền sai host

- **Mức độ:** Low
- **Danh mục:** Autofill / Logic
- **Vị trí:** `content.js:146-150` (badge), `content.js:659-663` (`trigger_autofill_creds`)

**Bằng chứng:**
```js
// content.js:146-150
const matching = history.filter(h => {
  if (h.url) return sameDomain(h.url, location.href);      // nhánh tốt: khớp host chính xác
  return !!(h.name && (h.name.toLowerCase() === domain || domain.includes(h.name.toLowerCase())));
});
// content.js:659-663
const nameMatch = h.name && (h.name.toLowerCase() === domain || domain.includes(h.name.toLowerCase()));
const urlMatch = h.url && h.url.toLowerCase().includes(domain);
```
Khi bản ghi **không có `url`** (vd mục lưu từ menu chuột phải/CSV), khớp dựa trên `domain.includes(h.name)`. Nếu `h.name` là chuỗi ngắn (vd `"a"`, `"vn"`, `"com"`), nó khớp rất nhiều host. `urlMatch` dùng `includes` nên `https://example.com.evil.com` cũng khớp `example.com`. Điều này **mâu thuẫn** với README dòng 197 ("chỉ điền khi host khớp chính xác").

**Tác động:** Có thể điền mật khẩu đã lưu vào host không mong muốn hoặc domain mạo danh chứa chuỗi khớp → rò rỉ credential (vẫn cần người dùng bấm).

**Khuyến nghị:** Bỏ nhánh khớp theo tên khi điền; chỉ autofill khi host (đã bỏ `www.`) **khớp chính xác**; dùng `hostname ===` thay `includes`; từ chối bản ghi không có `url`.

### 3.4 Các khía cạnh khác của content script (đã kiểm chứng)

- **DOM text injection / escaping — TỐT:** mọi nội dung do trang/dữ liệu người dùng đưa vào `innerHTML` đều qua `escapeHtml` (`content.js:42-50`, dùng ở 246, 250, 473, 475, 476, 481, 487, 493). Toast dùng `textContent` (`content.js:33`). `badge.innerHTML` chỉ chứa SVG tĩnh (`content.js:162`). Không thấy điểm chèn chuỗi chưa escape.
- **Page-context bridge — TỐT:** không có `window.postMessage`, không có `window.addEventListener("message")`, không inject `<script>` vào trang (grep xác nhận 0 kết quả). Trang web không có kênh điều khiển content script.
- **`canvas`/`img` cross-origin — an toàn:** `content.js:695-720` vẽ ảnh trang vào canvas rồi `getImageData`; với ảnh cross-origin canvas bị "tainted" → `getImageData` ném `SecurityError`, được `catch` (`content.js:714-716`). Chỉ đọc được pixel ảnh same-origin/CORS → không tạo rò rỉ mới.
- **iframe — hạn chế tự nhiên:** do manifest không bật `all_frames`, content script chỉ chạy ở top frame. Guard `fill_2fa` (`content.js:768-772`) là phòng thủ kép tốt. Nếu bật `all_frames`, `fill_generated_password`/`trigger_autofill_creds` sẽ thiếu guard (xem 2.5).


---

## 4. `vault.js` — Đánh giá thiết kế mật mã

### 4.1 Tham số KDF so với khuyến nghị OWASP

**Bằng chứng (`vault.js:15-23`):**
```js
var KDF_NAME = "argon2id";
var PARAMS = { iterations: 3, memorySize: 65536, parallelism: 4, hashLength: 32 };
// 64 MiB, OWASP baseline; hash-wasm memorySize tinh bang KiB
var AAD = new TextEncoder().encode("genpass-vault|v2|aes-256-gcm");
var IV_LEN = 12;
var SALT_LEN = 16;
```
- **Đánh giá:** OWASP Password Storage Cheat Sheet khuyến nghị Argon2id **tối thiểu** `m=19 MiB, t=2, p=1` (hoặc `m=46 MiB, t=1, p=1`). Cấu hình `m=64 MiB, t=3, p=4` **vượt baseline** → **TỐT**. `hashLength: 32` = khóa 256-bit khớp AES-256. ✅
- **Hạn chế:** Không có "pepper"/tham số `secret` thứ hai — chấp nhận được với ứng dụng offline.

### 4.2 Salt / IV / AAD

- **Salt:** 16 byte ngẫu nhiên sinh **mỗi lần** `encryptWithPin` (`vault.js:151`), lưu trong blob. Khi lưu lại (không đổi PIN), `reencrypt` **tái dùng** salt cũ (`vault.js:158-161`) — **đúng**, vì salt chỉ cần duy nhất theo khóa.
- **IV:** 12 byte ngẫu nhiên sinh **mỗi lần** `sealBlob` (`vault.js:113`) → không tái dùng IV cho cùng khóa. ✅ (Rất quan trọng với GCM.)
- **AAD:** hằng số `"genpass-vault|v2|aes-256-gcm"` (`vault.js:18`) gắn vào cả encrypt (`:115`) và decrypt (`:136`) → phát hiện đổi cấu trúc/phiên bản blob. ✅
- **Tag:** `tagLength: 128` bit (`vault.js:115,136`). ✅

### 4.3 Xử lý khóa — `extractable=false`

**Bằng chứng (`vault.js:89-93`):**
```js
function importAesKey(keyOrKeyB64) {
  var raw = keyOrKeyB64 instanceof Uint8Array ? keyOrKeyB64 : b64decode(keyOrKeyB64);
  return subtle().importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
```
- `extractable = false` → khóa `CryptoKey` không thể `exportKey`. ✅
- **Hạn chế (F-20):** Đầu ra Argon2id (32 byte) **chính là** khóa AES (không qua HKDF tách khóa). Chấp nhận được vì chỉ dùng cho mã hóa, nhưng `keyB64` (base64 khóa thô) được lưu **plaintext** trong `chrome.storage.session` (`popup.js:1242-1245`, `background.js:346-353`) và truyền giữa các context dạng chuỗi — khóa đối xứng ở dạng đọc được (chỉ trong RAM). Nên lưu dạng `CryptoKey` không extractable trong SW thay vì chuỗi base64 nếu có thể.

### 4.4 `keyB64` có bị lưu plaintext xuống `storage.local` không?

**Kiểm chứng:** grep toàn bộ `popup.js`/`background.js` cho thấy `genVaultKey` **chỉ** được ghi vào `chrome.storage.session` (`popup.js:1242-1245`; `background.js:346,356,734,745`), **không** bao giờ ghi vào `chrome.storage.local`. Thứ nằm trong `storage.local` là blob mã hóa `genVault`. ⇒ **ĐẠT**: khóa phiên không lưu xuống đĩa. ✅ (chỉ lo ngại `storage.session` là RAM).

### 4.5 Kiểm tra toàn vẹn / chống downgrade blob

**Bằng chứng (`vault.js:95-109`):**
```js
function checkBlob(blob) {
  if (!blob || blob.v !== 2 || blob.kdf !== KDF_NAME ||
      typeof blob.salt !== "string" || typeof blob.iv !== "string" || typeof blob.ct !== "string" ||
      blob.t !== PARAMS.iterations || blob.m !== PARAMS.memorySize || blob.p !== PARAMS.parallelism)
    throw new Error("GPVAULT_BAD_BLOB");
}
```
- Ép `v===2`, `kdf==='argon2id'`, **cố định** `t/m/p` theo hằng số → chống **downgrade tham số KDF**. ✅
- AAD + GCM tag chống sửa đổi ciphertext. ✅
- **Hạn chế:** Không ràng buộc blob với `keyId`/`vaultId`; không chống **rollback** (thay blob hợp lệ cũ hơn). Với mô hình đe dọa cục bộ, rủi ro thấp. Không có `v>=3` → blob v3 tương lai bị từ chối (fail-closed, an toàn).

### 4.6 `JSON.parse` dữ liệu giải mã & thông báo lỗi

- `decryptBlob` (`vault.js:140`): `return JSON.parse(new TextDecoder().decode(raw));` — dữ liệu do chính tiện ích mã hóa (không phải input không tin cậy); nếu blob bị sửa, GCM ném lỗi **trước** khi tới `JSON.parse`. ⇒ Không tạo injection. ✅
- **Thông báo lỗi:** hằng chuỗi chung (`GPVAULT_NO_KDF`, `GPVAULT_NO_SUBTLE`, `GPVAULT_BAD_BLOB`) hoặc `OperationError`; popup hiển thị "Mã PIN không đúng" chung (`popup.js:1408`), **không** phân biệt "sai PIN" vs "blob hỏng" → **không rò rỉ oracle**. ✅

### 4.7 Rate-limiting tầng crypto & độ mạnh PIN

- **Không có** rate-limit ở `vault.js`; `unlockWithPin` gọi thẳng KDF + decrypt. Rate-limit chỉ ở UI popup (xem F-09).
- **Độ mạnh PIN (`popup.js:1509-1511`):**
```js
function vaultSecretOk(s) { return s.length >= 8 && (/\D/.test(s) ? true : s.length >= 10); }
```
⇒ tối thiểu 8 ký tự (có chữ) hoặc 10 chữ số. Với chỉ số, `10^10` tổ hợp nhưng PIN người dùng thường yếu (`1234567890`, ngày sinh…). Argon2id 64 MiB là hàng rào chính. **Không** có kiểm tra entropy/blacklist PIN phổ biến. Mức: Low (khuyến nghị: blacklist PIN phổ biến, khuyến khích passphrase).


---

### F-08 — [Medium] Mặc định kho KHÔNG mã hóa (opt-in)

- **Mức độ:** Medium
- **Danh mục:** Data-at-rest
- **Vị trí:** `popup.js:1587-1591`, `content.js:69-79`, `popup.js:410`

**Bằng chứng:**
```js
// popup.js:1587-1591
async function persist(key, value) {
  if (!vaultOn || !vaultKey || !vaultBlob) {
    chrome.storage.local.set({ [key]: value });   // <-- plaintext
    return;
  }
  ...
}
// popup.js:410
let vaultOpts = { vaultEnabled: false, vaultLockClose: true, vaultTimeoutMin: 15 };
```
Vault là **tùy chọn** (`vaultEnabled` mặc định false). Khi chưa bật, `genHistory` (mật khẩu), `gen2FA` (seed TOTP), `genCards` (số thẻ + CVV), `genCookieProfiles` (cookie phiên đăng nhập) được lưu **nguyên văn** trong `chrome.storage.local` (LevelDB trên đĩa).

**Tác động:** Bất kỳ tiến trình nào đọc được profile Chrome (malware người dùng, người khác dùng chung máy, sao lưu/tháo ổ đĩa) đều lấy được toàn bộ secret. Đây là rủi ro "an toàn dữ liệu khi nghỉ" lớn nhất nếu người dùng không bật vault.

**Khuyến nghị:** Cân nhắc mã hóa mặc định (tạo khóa ngẫu nhiên bảo vệ bằng `storage.session`), hoặc cảnh báo nổi bật khi lưu secret đầu tiên mà chưa bật vault; tối thiểu hiển thị rõ trạng thái "Kho chưa mã hóa" (đã có ở `popup.js:1262-1264`) kèm hướng dẫn bật.

### F-16 — [Low] `persist()` ghi plaintext khi vault bật nhưng đang khóa

- **Mức độ:** Low
- **Danh mục:** Data-at-rest (tiềm ẩn)
- **Vị trí:** `popup.js:1587-1591`

**Bằng chứng:** Điều kiện `if (!vaultOn || !vaultKey || !vaultBlob)` → ghi thẳng `chrome.storage.local.set({ [key]: value })`. Khi vault **được bật** nhưng popup đang khóa (`vaultOn=false`), bất kỳ lời gọi `persistKey(...)` nào cũng ghi **plaintext** trái với ý định mã hóa, để lại secret chưa mã hóa trong `storage.local`.

**Đánh giá khai thác:** UI đã bị chặn bởi màn hình khóa (`popup.js:1676 vaultShowLock`), nên hiện tại các caller `persistKey` (`popup.js:1021,1129,1172,1769,1793,1918,2037,2176,2410,3184,3259,3267,3764`) khó chạm tới khi đang khóa. ⇒ Mức Low, nhưng là lỗi logic nguy hiểm nếu refactor.

**Khuyến nghị:** Nếu `vaultOpts.vaultEnabled === true` mà `!vaultOn` → **từ chối ghi** (fail-closed):
```js
if (vaultOpts.vaultEnabled) { if (!vaultOn || !vaultKey || !vaultBlob) throw new Error("VAULT_LOCKED"); }
else { chrome.storage.local.set({ [key]: value }); return; }
```

### F-09 — [Medium] Rate-limit PIN yếu, chỉ trong RAM, không ràng buộc tầng crypto

- **Mức độ:** Medium
- **Danh mục:** Authentication / Brute-force
- **Vị trí:** `popup.js:427-428`, `popup.js:1375-1413`

**Bằng chứng:**
```js
// popup.js:427-428
let vaultFailedAttempts = 0;
let vaultLockoutUntil = 0;
// popup.js:1404-1407
vaultFailedAttempts++;
if (vaultFailedAttempts >= 5) { vaultLockoutUntil = Date.now() + 15000; }
```
- Bộ đếm nằm trong **biến RAM của popup** → **reset hoàn toàn** khi đóng/mở lại popup. Người dùng máy chung chỉ cần đóng popup để có lại 5 lần thử.
- Khóa tạm chỉ **15 giây**; không tăng theo số lần; không lưu bền.
- Không có rate-limit ở `vault.js` hay SW.
- Đối chiếu README dòng 187 ("ngăn chặn các công cụ tự động thử hàng nghìn mã mỗi giây") — **claim quá mức**.

**Khuyến nghị:** Lưu bộ đếm + thời điểm khóa vào `chrome.storage.local`/`session` (không reset khi đóng popup); dùng exponential backoff (5 lần → 30s, 10 lần → 5 phút…); áp dụng cả ở tầng SW/crypto.


---

## 5. Dữ liệu khi nghỉ (Data-at-rest) & đường di trú

### 5.1 Bản đồ lưu trữ

| Khóa | Nơi lưu | Khi vault TẮT | Khi vault BẬT |
| :--- | :--- | :--- | :--- |
| `genOptions` | `storage.local` | plaintext (không secret) | plaintext (không secret) |
| `genHistory` | `storage.local` | **plaintext** (mật khẩu) | trong blob `genVault` |
| `gen2FA` | `storage.local` | **plaintext** (seed TOTP) | trong blob `genVault` |
| `genCards` | `storage.local` | **plaintext** (PAN/CVV) | trong blob `genVault` |
| `genCookieProfiles` | `storage.local` | **plaintext** (cookie phiên) | trong blob `genVault` |
| `genTags` | `storage.local` | plaintext (không secret) | trong blob `genVault` |
| `genVault` | `storage.local` | — | blob AES-256-GCM |
| `genVaultKey` | `storage.session` | — | `{k: keyB64, exp}` (RAM) |
| `genUpdateInfo`, `dismissedUpdateVer` | `storage.local` | version string | version string |

⇒ **Kết luận:** Không có secret nào bị ghi plaintext xuống `storage.local` **khi vault đang bật và đã mở khóa** (ngoại trừ đường tiềm ẩn F-16). Khi vault tắt (mặc định), toàn bộ secret nằm plaintext (F-08).

### 5.2 Đường di trú khi bật vault — tính đúng đắn

**Bằng chứng (`popup.js:1419-1446`):**
```js
async function vaultShredPlaintext() {
  const keys = ["genHistory", "gen2FA", "genCards", "genCookieProfiles", "genTags"];
  const cur = await chrome.storage.local.get(keys);
  const junk = {};
  keys.forEach(k => { const len = JSON.stringify(cur[k] ?? []).length; if (len > 2) junk[k] = "x".repeat(len); });
  if (Object.keys(junk).length) await chrome.storage.local.set(junk);   // ghi rác cùng độ dài
  await chrome.storage.local.remove(keys);                              // rồi xóa
}
async function vaultEnable(secret) {
  const payload = { genHistory: currentHistory, gen2FA: current2FA, genCards: currentCards, genCookieProfiles: currentCookieProfiles, genTags: currentTags };
  const blob = await GPVault.encryptWithPin(payload, secret);
  const keyB64 = (await GPVault.unlockWithPin(blob, secret)).keyB64;
  await chrome.storage.local.set({ genVault: blob });
  await vaultShredPlaintext();
  await vaultSessionSet(keyB64, vaultTimeoutMin());
  ...
}
```
- **Tích cực:** Ghi blob **trước**, rồi mới shred plaintext → không mất dữ liệu nếu shred thất bại. Ghi đè bằng chuỗi rác cùng độ dài trước khi `remove()` → giảm khả năng phục hồi từ LevelDB. README dòng 200-201 ghi đúng và thừa nhận đây là biện pháp giảm thiểu, không tuyệt đối. ✅
- **Hạn chế (Low, README đã ghi nhận):** `remove()` trên `chrome.storage.local` chỉ xóa key logic; dữ liệu cũ có thể còn trong **WAL/SST của LevelDB** và bản sao lưu; ghi đè bằng rác không đảm bảo ghi cùng vị trí vật lý.
- **Tắt vault (`popup.js:1458-1479`):** giải mã rồi ghi lại **plaintext** các key và xóa `genVault` → quay về trạng thái F-08 (đúng theo thiết kế, nhưng người dùng cần hiểu rõ).
- **Đổi PIN (`popup.js:1481-1489`):** `encryptWithPin` sinh **salt mới** → blob mới, `vaultKey` được cập nhật. ✅

### 5.3 Clipboard

- Popup: `scheduleClipboardClear` xóa sau 30s nếu option bật (`popup.js:966-980`) — **TỐT** cho luồng popup.
- Content script (menu chuột phải): **không** tự xóa (F-10).
- Xuất cookie JSON vào clipboard (`popup.js:4205`) cũng gọi `scheduleClipboardClear`. ✅
- OTP điền vào trang (`popup.js:768-782`): nếu không tìm thấy ô thì copy OTP + `scheduleClipboardClear`. ✅


---

## 6. Thực thi mã bên thứ ba / Remote code / `eval` / WASM / CSP bypass

### 6.1 Kết quả kiểm tra

| Hạng mục | Kết quả |
| :--- | :--- |
| `eval(` / `new Function(` trong mã GenPass (`background.js`, `content.js`, `popup.js`, `vault.js`) | **Không có** (grep 0 kết quả). ✅ |
| `eval(` / `new Function(` trong `vendor/hash-wasm.umd.js`, `jsqr.js` | **Không có** (grep đếm = 0). ✅ |
| `document.write` / `insertAdjacentHTML` / `outerHTML` | Không có trong mã GenPass. ✅ |
| `innerHTML` | Có trong `content.js` và `popup.js`, **nhưng** đều là template tĩnh hoặc dữ liệu đã `escapeHtml` (xem 3.4). ✅ |
| `chrome.scripting` / `chrome.tabs.executeScript` | Không có. ✅ |
| `importScripts` remote | Chỉ nạp **file nội bộ**: `vendor/hash-wasm.umd.js`, `vault.js`, `jsqr.js`, `wordlist.js` (`background.js:3,9,15,21`). ✅ |
| WASM | Chỉ từ `vendor/hash-wasm.umd.js` (đóng gói sẵn). CSP `'wasm-unsafe-eval'` cho phép compile WASM nội bộ. Không tải WASM từ mạng. ✅ |
| CSP bypass | `script-src 'self' 'wasm-unsafe-eval'`, không có `'unsafe-inline'`/remote → khó bypass; không thấy gadget. ✅ |

### 6.2 Ngoại lệ: endpoint mạng ra ngoài

- `background.js:675` — `fetch("https://raw.githubusercontent.com/lengoctuong2005/GenPass/main/manifest.json?t=...")` (kiểm tra cập nhật; xem F-15).
- `popup.js:422,647` — tải ảnh VietQR từ `https://img.vietqr.io/...` (tab "Ủng hộ"). Đây là request ra **bên thứ ba**, tiết lộ IP/User-Agent/thời điểm mở tab Ủng hộ cho `img.vietqr.io`. Đối chiếu claim "100% ngoại tuyến / zero telemetry" (README dòng 185) → **không chính xác tuyệt đối** (rò rỉ metadata, không phải nội dung secret).
- `popup.js:937-946` — nạp ảnh ứng viên QR từ URL do trang cung cấp (F-05).

⇒ **Không có remote code execution / remote script.** Rủi ro chính là **SSRF/beacon mạng** (F-01..F-05, F-15), không phải chạy mã từ xa.

### F-14 — [Low] Hash SHA-256 của vendor trong tài liệu KHÔNG khớp file thực tế

- **Mức độ:** Low (supply chain / integrity)
- **Danh mục:** Supply chain
- **Vị trí:** `vault.js:4-8`

**Bằng chứng:**
```js
//   file:   vendor/hash-wasm.umd.js  (283696 bytes)
//   sha256: 4c623029dcde56c12ae2dc290f90e616cfeb4734e23575bb08c01cdeac3acbe3
```
Chạy thực tế:
```
$ sha256sum vendor/hash-wasm.umd.js
bf24100d2dbbad074b152065790c7aacaef8369ac6a8461ca768ce79592902eb  vendor/hash-wasm.umd.js
```
Hash tài liệu (`4c6230…`) **khác** hash thực tế (`bf2410…`).

**Tác động:** Không thể dùng hash này để xác minh toàn vẹn/nguồn gốc vendor (pin supply-chain vô hiệu). Nếu hash "cũ" thì là lỗi tài liệu; nếu file bị thay đổi thì là dấu hiệu xấu — không xác định được nếu không có bản tham chiếu chính thức (xem mục 8).

**Khuyến nghị:** Tính lại hash đúng và cập nhật `vault.js` + `NOTICE`; thêm script kiểm tra hash trong CI (`tests/`) và pin hash cho `jsqr.js`/`wordlist.js`.

### F-18 — [Info] CSP & manifest hardening còn thiếu

- **Mức độ:** Info · **Danh mục:** Hardening · **Vị trí:** `manifest.json:6-8`

**Bằng chứng:** `"extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"` — tốt nhưng thiếu directive hardening; manifest **thiếu** `minimum_chrome_version`.

**Khuyến nghị:** Bổ sung `default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` (kiểm thử để không phá tính năng), và thêm `"minimum_chrome_version": "102"` (do dùng `storage.session.setAccessLevel`).

### F-19 — [Info] Xuất/nhập cookie dạng JSON (clipboard) & ghi cookie tùy ý

- **Mức độ:** Info · **Danh mục:** Cookie handling · **Vị trí:** `popup.js:4126-4185`, `popup.js:4199-4207`, `popup.js:3738-3760`

**Bằng chứng:** Xuất `JSON.stringify(cookies)` vào clipboard (`popup.js:4204-4205`); nhập JSON do người dùng dán rồi `chrome.cookies.set(clean)` cho mọi cookie (`popup.js:4160-4163`). `prepareCookieForSet` giữ `domain`/`secure`/`httpOnly`/`sameSite` từ JSON.

**Tác động:** Cookie phiên (session token) bị đưa ra clipboard (tự xóa nếu option bật); nhập JSON có thể ghi cookie tùy ý (do người dùng chủ động). `chrome.cookies.set` yêu cầu URL khớp domain nên không ghi được cookie cross-domain tùy tiện.

**Khuyến nghị:** Cảnh báo rõ khi xuất cookie; mặc định luôn auto-clear clipboard; cân nhắc mã hóa JSON xuất/nhập.

### F-20 — [Info] Khóa AES lưu dạng base64 trong `storage.session`; KDF output dùng trực tiếp làm AES key

- **Mức độ:** Info · **Danh mục:** Crypto/Key handling · **Vị trí:** `popup.js:1242-1245`, `background.js:346-362`, `vault.js:143-148`

**Bằng chứng:**
```js
// popup.js:1242-1245
function vaultSessionSet(keyB64, timeoutMin) {
  return chrome.storage.session.set({ genVaultKey: { k: keyB64, exp: timeoutMin > 0 ? Date.now() + timeoutMin * 60000 : null } });
}
// vault.js:147
return { data: data, keyB64: b64encode(raw) };   // raw = output Argon2id = AES key
```
Khóa đối xứng được lưu/truyền dạng chuỗi base64 (đọc được) thay vì `CryptoKey` không extractable. Chỉ trong RAM (`storage.session`) và giới hạn `TRUSTED_CONTEXTS` → rủi ro thấp.

**Khuyến nghị:** Giữ `CryptoKey` (không extractable) trong bộ nhớ SW và tham chiếu bằng id, tránh serialize khóa ra chuỗi.

### F-17 — [Low] `decodeQrFromUrl` không giới hạn kích thước/timeout ảnh

- **Mức độ:** Low · **Danh mục:** DoS · **Vị trí:** `background.js:296-308`

**Bằng chứng:**
```js
const response = await fetch(url);
const blob = await response.blob();
const bitmap = await createImageBitmap(blob);
const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
```
Không giới hạn `Content-Length`, không timeout, không kiểm tra kích thước bitmap trước khi cấp canvas. Một trang có thể trỏ tới ảnh khổng lồ (hoặc endpoint nội bộ trả dữ liệu lớn) làm SW tốn RAM/CPU → treo service worker (DoS cục bộ).

**Khuyến nghị:** Giới hạn kích thước tải (vd từ chối nếu `Content-Length` > 5 MB), dùng `AbortSignal.timeout()`, và kiểm tra `bitmap.width*bitmap.height` trước khi tạo canvas.


---

## 7. Điểm tốt (điểm mạnh đã xác nhận)

Các điểm dưới đây đã được **kiểm chứng bằng cách đọc mã và/hoặc chạy thực tế**, không chỉ dựa trên tài liệu:

1. **Mật mã đúng chuẩn (vault.js):**
   - Argon2id `t=3, m=64 MiB, p=4, hashLength=32` — **vượt** baseline OWASP (`vault.js:16`).
   - AES-256-GCM, `tagLength: 128`, **IV 12 byte ngẫu nhiên mới mỗi lần mã hóa** (`vault.js:113`), **salt 16 byte ngẫu nhiên mỗi lần KDF** (`vault.js:151`).
   - **AAD** hằng số gắn vào cả encrypt/decrypt (`vault.js:18,115,136`).
   - `importKey(..., false, ["encrypt","decrypt"])` → khóa **`extractable=false`** (`vault.js:92`).
   - `checkBlob` ép `v=2`, `kdf=argon2id`, `t/m/p` cố định → **chống downgrade tham số** (`vault.js:95-109`).
   - Dùng `crypto.getRandomValues` cho mọi random (`vault.js:52-56`); bộ sinh mật khẩu dùng rejection sampling loại modulo-bias (`background.js:156-164`).

2. **Khóa phiên không bị ghi xuống đĩa:** `genVaultKey` **chỉ** nằm trong `chrome.storage.session` (RAM), không bao giờ vào `storage.local` (đã grep xác minh). ✅

3. **`storage.session` được đặt `TRUSTED_CONTEXTS`** tường minh (`background.js:27-32`) → content script không đọc trực tiếp được khóa. ✅

4. **CSP mạnh:** `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'` — không `'unsafe-inline'`, không nguồn remote (`manifest.json:6-8`). ✅

5. **Không có remote code / `eval`:** không `eval`/`new Function` trong mã GenPass **và** trong vendor (grep = 0); `importScripts` chỉ nạp file nội bộ; WASM chỉ từ `vendor/` đóng gói sẵn. ✅

6. **Không có bridge page↔extension:** không `window.postMessage`, không listener `message`, không inject `<script>` vào trang (grep = 0). Trang web không có kênh điều khiển content script. ✅

7. **`externally_connectable` không khai báo** → trang web/extension khác **không** gửi được message tới SW. ✅

8. **`web_accessible_resources` không khai báo** → tài nguyên tiện ích không lộ cho web. ✅

9. **Escape HTML đúng trong content script:** mọi chèn dữ liệu vào `innerHTML` đều qua `escapeHtml` (`content.js:42-50` + các điểm dùng); toast dùng `textContent`. Không tìm thấy điểm XSS DOM nào. ✅

10. **Bộ lọc SSRF chặn được nhiều biến thể IP (đã chạy thực tế):** `127.*`, `10.*`, `192.168.*`, `172.16-31.*`, `169.254.*` (metadata), `localhost`, `0.0.0.0`, `.local/.localhost/.internal`, `::1`, `fe80:`, `fc00:`/`fd00:`, `javascript:`, `ftp:`; **và** nhờ URL parser chuẩn hóa nên cả `0x7f.0.0.1`, `0177.0.0.1`, `2130706433`, `0x7f000001`, `LOCALHOST`, `127.0.0.1.` đều bị chặn. (Tuy vẫn còn bypass — F-01..F-04.)

11. **Guard top-frame cho OTP:** `fill_2fa` từ chối chạy trong iframe (`content.js:768-772`), và manifest không bật `all_frames` → content script chỉ ở top frame. ✅

12. **Cơ chế khóa khi đóng popup đúng đắn:** đếm số port `"vault-session"` để không khóa nhầm khi có nhiều popup/side-panel (`background.js:719-738`); không dựa vào tác vụ bất đồng bộ của popup. ✅

13. **Shred plaintext trước khi xóa khi bật vault:** ghi đè bằng rác cùng độ dài rồi `remove()` (`popup.js:1419-1430`), và ghi blob trước khi shred (không mất dữ liệu). README ghi đúng giới hạn của biện pháp này. ✅

14. **Auto-clear clipboard trong popup** (30s, chỉ xóa nếu clipboard vẫn chứa đúng nội dung vừa copy) (`popup.js:966-980`). ✅

15. **Không lưu secret trong `genOptions`:** cài đặt (`popup.js:1216-1218`) không chứa mật khẩu/seed. ✅

16. **Thông báo lỗi không rò rỉ oracle:** UI chỉ hiện "Mã PIN không đúng" chung (`popup.js:1408`), không phân biệt sai PIN vs blob hỏng. ✅

17. **Kiểm tra Luhn + che số thẻ** trước khi lưu/nhập thẻ (`content.js:330-345,357-363`); CVV không hiển thị lại trong dialog lưu (`content.js:487`). ✅


---

## 8. Giới hạn của kiểm toán & những điểm CHƯA chắc chắn

Ghi rõ để tránh hiểu sai phạm vi:

1. **Không có môi trường Chrome thật:** SSRF được xác minh bằng cách chạy `isSafeFetchUrl` trong **Node.js** (dùng cùng URL parser WHATWG). Hành vi mạng thực tế của `fetch` (DNS, redirect, credentials) được suy luận từ **đặc tả Fetch** (mặc định `redirect: "follow"`, `credentials: "same-origin"`), **chưa** được kiểm chứng trên Chrome thật. Nếu Chrome có khác biệt, mức độ F-03/F-04 có thể thay đổi.
2. **DNS rebinding (F-04)** phụ thuộc hạ tầng mạng nạn nhân (có DNS nội bộ, resolver cho phép TTL thấp…). Tôi **chưa** chứng minh end-to-end; đây là đánh giá dựa trên mã.
3. **Hash vendor (F-14):** tôi xác nhận hash trong tài liệu **khác** hash file, nhưng **không thể** kết luận file có bị sửa hay không nếu không tải bản `hash-wasm@4.12.0` chính thức để so khớp (môi trường kiểm toán không có mạng). Cần xác minh ngoài phạm vi này.
4. **Khả năng khai thác F-06/F-07:** Tôi khẳng định **trang web không thể** gửi message trực tiếp tới SW (không có `externally_connectable`, không có bridge). Do đó đây là lỗ hổng **phòng thủ chiều sâu/ranh giới tin cậy**, không phải khai thác từ xa trực tiếp. Nếu mô hình đe dọa bao gồm "extension khác" hoặc "XSS trong content script", mức độ sẽ tăng lên High.
5. **`genUpdateInfo`:** đã kiểm tra nơi hiển thị (`popup.js:2578-2634`) thấy dùng `textContent` + link tĩnh tới GitHub. Nếu còn nơi khác render động, cần rà thêm — tôi chưa thấy.
6. **`popup.js` (4349 dòng)** chỉ được rà các phần liên quan bảo mật (vault, cookie, clipboard, update, autofill, i18n, donate). Các phần UI/rendering khác chưa rà toàn bộ; có thể còn vấn đề nhỏ chưa phát hiện.
7. **Kiểm thử hiện có** (`tests/security-i18n.test.cjs`) chỉ kiểm tra 14 case SSRF "dễ" và **không** bao gồm các bypass ở F-01..F-04 (không có test cho `::ffff:`, `fc01::`, redirect, DNS). Bộ test này tạo cảm giác an toàn giả — nên bổ sung các case trong Phụ lục A.

---

## Phụ lục A — Bằng chứng chạy thực tế hàm `isSafeFetchUrl`

Trích xuất nguyên hàm từ `background.js:264-293` và thực thi trong Node.js:

```
ALLOW  http://[::ffff:127.0.0.1]/          hostname=[::ffff:7f00:1]        <-- F-01
ALLOW  http://[::ffff:7f00:1]/             hostname=[::ffff:7f00:1]        <-- F-01
ALLOW  http://[0:0:0:0:0:ffff:7f00:1]/     hostname=[::ffff:7f00:1]        <-- F-01
ALLOW  http://[::ffff:169.254.169.254]/    hostname=[::ffff:a9fe:a9fe]     <-- F-01
ALLOW  http://[::ffff:192.168.1.1]/        hostname=[::ffff:c0a8:101]      <-- F-01
ALLOW  http://[::ffff:10.0.0.5]/           hostname=[::ffff:a00:5]         <-- F-01
ALLOW  http://[::ffff:7f00:1]:8080/        hostname=[::ffff:7f00:1]        <-- F-01
ALLOW  https://[::ffff:a9fe:a9fe]/         hostname=[::ffff:a9fe:a9fe]     <-- F-01
ALLOW  http://[64:ff9b::7f00:1]/           hostname=[64:ff9b::7f00:1]      <-- F-01 (NAT64)
ALLOW  http://[fc01::1]/                   hostname=[fc01::1]              <-- F-02
ALLOW  http://[fcff::1]/                   hostname=[fcff::1]              <-- F-02
ALLOW  http://[fd12::1]/                   hostname=[fd12::1]              <-- F-02
ALLOW  http://[fdff::1]/                   hostname=[fdff::1]              <-- F-02
ALLOW  http://100.64.0.1/                  hostname=100.64.0.1             <-- CGNAT 100.64/10
ALLOW  http://192.0.0.1/                   hostname=192.0.0.1              <-- 192.0.0.0/24
ALLOW  http://localtest.me/                hostname=localtest.me           <-- F-04 (DNS rebind)
ALLOW  http://foo.127.0.0.1.nip.io/        hostname=foo.127.0.0.1.nip.io   <-- F-04
ALLOW  http://kubernetes.default.svc/      hostname=kubernetes.default.svc <-- F-04
ALLOW  http://evil-rebind.example/         hostname=evil-rebind.example    <-- F-04
ALLOW  http://attacker.com/                hostname=attacker.com
ALLOW  http://127.0.0.1@evil.com/          hostname=evil.com               (host thật là evil.com - OK)
ALLOW  http://localhost.evil.com/          hostname=localhost.evil.com     (domain công khai - OK)
ALLOW  https://evil.com/                   hostname=evil.com

BLOCK  http://127.0.0.1/admin              (chặn đúng)
BLOCK  http://127.1.2.3:8080               (chặn đúng)
BLOCK  http://localhost:3000/api           (chặn đúng)
BLOCK  http://0.0.0.0:80/                  (chặn đúng)
BLOCK  http://192.168.1.1/router           (chặn đúng)
BLOCK  http://10.200.0.5/                  (chặn đúng)
BLOCK  http://172.16.0.1/                  (chặn đúng)
BLOCK  http://172.31.255.255/              (chặn đúng)
BLOCK  http://169.254.169.254/latest/meta-data  (chặn đúng)
BLOCK  http://[::1]/                       (chặn đúng)
BLOCK  http://[fe80::1]/                   (chặn đúng)
BLOCK  http://[fc00::1]/                   (chặn đúng - chỉ đúng tiền tố fc00:)
BLOCK  http://metadata.google.internal/    (chặn đúng)
BLOCK  http://0x7f.0.0.1/                  (chặn đúng nhờ URL parser)
BLOCK  http://0177.0.0.1/                  (chặn đúng nhờ URL parser)
BLOCK  http://2130706433/                  (chặn đúng nhờ URL parser)
BLOCK  http://0x7f000001/                  (chặn đúng nhờ URL parser)
BLOCK  http://127.0.0.1./                  (chặn đúng nhờ URL parser)
BLOCK  http://LOCALHOST/                   (chặn đúng nhờ URL parser)
BLOCK  http://user@127.0.0.1/              (chặn đúng)
BLOCK  http://127.0.0.1#@evil.com/         (chặn đúng)
BLOCK  ftp://example.com/file              (chặn đúng)
BLOCK  javascript:alert(1)                 (chặn đúng)
ALLOW  data:image/png;base64,...           (đúng thiết kế)
ALLOW  blob:chrome-extension://.../...     (đúng thiết kế)
```

**Đề xuất test bổ sung cho `tests/security-i18n.test.cjs`** (hiện đang thiếu): `::ffff:127.0.0.1`, `::ffff:169.254.169.254`, `[fc01::1]`, `[fdff::1]`, `100.64.0.1`, `192.0.0.1`, `localtest.me`, và một test cho `redirect: "manual"` trong `decodeQrFromUrl`.


---

## Phụ lục B — Ma trận ưu tiên khắc phục

| Ưu tiên | Finding | Hành động |
| :--- | :--- | :--- |
| P0 | F-01, F-02, F-03, F-04, F-05 | Viết lại `isSafeFetchUrl` theo CIDR + `redirect:"manual"` + `AbortSignal.timeout`, dùng chung cho cả `background.js` và `popup.js`; bổ sung test |
| P1 | F-06, F-07 | Kiểm tra `sender` + allowlist key; chỉ trả secret khi người dùng chủ động autofill |
| P1 | F-08 | Cảnh báo/bật mã hóa mặc định |
| P2 | F-09, F-10, F-11, F-13 | Rate-limit bền vững + exponential backoff; auto-clear clipboard ở mọi luồng; xác nhận trước khi lưu 2FA; khớp host chính xác |
| P2 | F-12 | Thu hẹp `host_permissions` (bỏ `http://*/*`, dùng `optional_host_permissions`) |
| P3 | F-14, F-15, F-16, F-17, F-18, F-19, F-20 | Vá hash vendor, ký/allowlist update, fail-closed `persist`, giới hạn kích thước ảnh, CSP/manifest hardening, cảnh báo cookie, lưu khóa dạng CryptoKey |

---

*Báo cáo được lập bằng phương pháp đọc mã tĩnh kết hợp chạy thực nghiệm. Mọi trích dẫn `file:line` phản ánh commit `b4a9b7f`.*

