# GenPass — Audit Hiệu năng / Tối ưu hoá & Bộ kiểm thử tự động

- **Repo:** `/workspace` (GenPass, Chrome MV3, `manifest.version = 1.2.0`)
- **Commit:** `b4a9b7f` (branch `main`)
- **Người thực hiện:** audit độc lập, **không sửa** bất kỳ file nguồn / test nào. Chỉ chạy lệnh read-only (`node`, `sha256sum`, `stat`, `grep`, `wc`).
- **Môi trường đo:** Debian GNU/Linux 12 (bookworm), `node v24.21.0`, `npm 11.19.0`. **Không có `google-chrome`** trên máy (kiểm chứng bên dưới).
- **Ngày:** 2026-10-11

> Quy ước: mọi phát hiện có **ID · Mức độ · Nhóm · Vị trí · Bằng chứng · Tác động · Khuyến nghị**. Không có số liệu nào được bịa; chỗ không kiểm chứng được ghi rõ "KHÔNG XÁC MINH ĐƯỢC".

---

## 0. Tóm tắt điều hành

| Hạng mục | Kết quả |
|---|---|
| `tests/security-i18n.test.cjs` | **PASS** (exit 0) — 0.031 s |
| `tests/vault.test.cjs` | **PASS** 15/15 (exit 0) — 7.44 s |
| `tests/integration.test.cjs` | **PASS** 10 flows / 105 checks (exit 0) — 15.29 s |
| `tests/e2e-chrome.cjs` | **KHÔNG CHẠY ĐƯỢC** — cần Chrome thật, máy không có → exit 1 sau ~80 s |
| Tổng asset ship ra | ~739 KB (chưa kể icons); `vendor/hash-wasm.umd.js` chiếm **42 %** bundle popup |
| Rủi ro hiệu năng cao nhất | (1) `jsqr.js` 130 KB tiêm vào **mọi** trang; (2) ticker 2FA dựng lại DOM + HMAC **mỗi giây**; (3) ghi storage mỗi lần kéo slider; (4) Argon2id ~250 ms **chặn main thread** popup |
| Rủi ro chuỗi cung ứng cao nhất | `vault.js` ghi **sai cả size lẫn sha256** của `vendor/hash-wasm.umd.js`; `NOTICE` **thiếu** hash-wasm |

---

## 1. Kết quả chạy bộ kiểm thử (nguyên văn)

### 1.1 `node tests/security-i18n.test.cjs`

Lệnh:
```
cd /workspace && time node tests/security-i18n.test.cjs
```
Kết quả nguyên văn:
```
=== Running Security & i18n Test Suite ===
✓ SSRF filter tests passed (14/14)
✓ Donate & GitHub verification passed
✓ i18n dictionary completeness passed (80 matching bilingual keys)
✓ Vault PIN rate-limiting logic present

ALL SECURITY & i18n TESTS PASSED! (4/4 test groups)
EXIT=0

real    0m0.031s
user    0m0.016s
sys     0m0.015s
```
→ **PASS, exit 0, 31 ms.**

### 1.2 `node tests/vault.test.cjs`

Lệnh:
```
cd /workspace && time node tests/vault.test.cjs
```
Kết quả nguyên văn (rút gọn các dòng trùng, giữ đúng số liệu):
```
✔ A0 PARAMS + KDF_NAME exported for UI display (1.32138ms)
✔ A1 encryptWithPin -> unlockWithPin roundtrip + 44-char (32-byte) key (494.436494ms)
✔ A2 wrong secret rejects with OperationError (479.703824ms)
✔ A3 verifySecret: true with right secret, throws with wrong (727.272291ms)
✔ A4 tamper detection + malformed blob (959.682608ms)
✔ A5 reencrypt (per-save path: no KDF, salt stable, iv rotated) (752.873641ms)
✔ A6 decryptBlob accepts raw key bytes AND base64 string (496.040144ms)
✔ A7 b64encode/b64decode roundtrip on >16KB buffer (chunked path) (1.18379ms)
✔ A8 empty arrays payload roundtrip (497.965514ms)
✔ A9 large (200KB+) Vietnamese + emoji payload roundtrip (502.050114ms)
✔ A10 AAD is bound: decrypt with a key but WITHOUT the AAD fails (510.960744ms)
✔ K1 Argon2id KAT: vendored hash-wasm reproduces reference vectors EXACTLY (579.455133ms)
✔ K2 hashSecret: deterministic, 32 bytes, salt-sensitive (802.37648ms)
✔ N1 hashSecret throws GPVAULT_NO_KDF when hash-wasm unavailable (38.0999ms)
unlockWithPin took 265.4 ms (Argon2id m=65536 t=3 p=4)
✔ P1 unlockWithPin completes well under 5s (543.810463ms)
ℹ tests 15
ℹ pass 15
ℹ fail 0
ℹ skipped 0
ℹ duration_ms 7393.96008
EXIT=0

real    0m7.444s
```
→ **PASS 15/15, exit 0, 7.44 s.**

### 1.3 `node tests/integration.test.cjs`

Lệnh:
```
cd /workspace && time node tests/integration.test.cjs
```
Phần SUMMARY nguyên văn:
```
================================================================================
SUMMARY
================================================================================
  PASS  T1   Vault OFF baseline - plaintext untouched, history rendered  (7/7, 135 ms)
  PASS  T2   Enable vault - v2 blob, plaintext shredded, session envelope  (17/17, 1627 ms)
  PASS  T3   Relock on popup close - session key must not survive (user bug)  (10/10, 914 ms)
  PASS  T3b  Relock on close WITH vaultLockClose=true - control case  (7/7, 2136 ms)
  PASS  T4   Unlock wrong PIN then right PIN, plus SW vault_get  (13/13, 3407 ms)
  PASS  T6   SW vault_put re-encrypts the blob without touching salt  (8/8, 407 ms)
  PASS  T5   Idle timeout - expired session key reports locked and is removed  (6/6, 405 ms)
  PASS  T8   Content-script relay - {__locked:true} then merged data after unlock  (9/9, 2361 ms)
  PASS  T7   Disable vault - plaintext restored, blob and session key removed  (12/12, 1906 ms)
  PASS  T9   Weak-secret policy - 5 digits refused, 10 digits accepted  (16/16, 1927 ms)

  flows            : 10
  checks           : 105
  failed checks    : 0 (0 declared-defect, 0 unexpected)
  legend           : PASS = every check ok | BUG = only declared-defect reproductions | FAIL = unexpected
  exit code        : 0 (a declared-defect reproduction does not fail the suite)
  defects declared : BUG-1, BUG-2
  BUG-1 not reproduced - vaultEnable() persisted the options before syncing the lock-on-close checkbox
  BUG-2 not reproduced - vaultEnable() overwrote the lock-on-close checkbox after saving the options
  OBS-1 NOT OBSERVED - vault shred writes junk strings; the popup's own onChanged listener then throws
      occurrences in this run: 0

  suite wall time: 15245 ms
================================================================================
EXIT=0

real    0m15.289s
```
→ **PASS 10 flows / 105 checks, 0 fail, exit 0, 15.29 s.** (Chrome surface exercised: 21 API; popup realm: 13; element ids touched: 163.)

### 1.4 `node tests/e2e-chrome.cjs` — CẦN CHROME THẬT

**Kiểm tra binary Chrome:**
```
$ which google-chrome chromium chromium-browser google-chrome-stable
(no output)
$ ls -la /usr/bin/google-chrome*
(no output)
```
`tests/e2e-chrome.cjs:30` — `const CHROME_BIN = process.env.E2E_CHROME || "/usr/bin/google-chrome";`

**Kết quả chạy nguyên văn** (sau ~80 s, do `BOOT_TIMEOUT = 30000` được thử 2 lần):
```

[INFO] thu --load-extension khong thanh cong: waitDevtools=null dead=true exitInfo=spawn error: spawn /usr/bin/google-chrome ENOENT

[INFO] --load-extension khong hieu luc (Google Chrome >= 138): bootstrap profile + developer mode

FATAL: Error: khong thay Default/Preferences sau lan boot dau
          at injectExtensionIntoProfile (/workspace/tests/e2e-chrome.cjs:234:39)
          at main (/workspace/tests/e2e-chrome.cjs:507:11)
EXIT CODE: 1
EXITCODE=1
```
→ **KHÔNG CHẠY ĐƯỢC trong môi trường này.** Cần Chrome thật (không cần mạng; giao tiếp qua CDP `--remote-debugging-port`). Không có scenario nào được thực thi, **0 PASS / 0 FAIL / 12 scenario (S0–S10) KHÔNG XÁC MINH ĐƯỢC**.

---


## 2. Chất lượng bộ kiểm thử

### T-01 — [CAO] Test rate-limit PIN chỉ kiểm tra *chuỗi ký tự trong source*, không hề thực thi logic
- **Nhóm:** Test / false-confidence
- **Vị trí:** `tests/security-i18n.test.cjs:61-64`
```js
assert(popupContent.includes("vaultLockoutUntil"), "vaultLockoutUntil rate-limit variable must exist");
assert(popupContent.includes("vaultFailedAttempts"), "vaultFailedAttempts counter must exist");
console.log("✓ Vault PIN rate-limiting logic present");
```
- **Bằng chứng:** hai `assert` chỉ là `String.includes()` trên nội dung `popup.js`. Không có hàm nào được gọi, không có counter nào bị tăng, không có khoá nào bị kiểm tra.
- **Tác động:** Nếu toàn bộ logic rate-limit bị **vô hiệu hoá** (ví dụ đổi điều kiện thành `if (false)`, hoặc xoá phần đếm mà vẫn còn khai báo biến) thì test **vẫn PASS**. Đây là test "xanh" ngay cả khi tính năng đã hỏng.
- **Khuyến nghị:** trích xuất và **thực thi** hàm kiểm tra khoá (như file này làm với `isSafeFetchUrl` bằng `new Function`), hoặc chuyển sang harness `node:vm` như `integration.test.cjs`; assert rằng lần thử sai thứ N trả về lỗi/khoá.

### T-02 — [TRUNG BÌNH] Test i18n chỉ kiểm tra *sự tồn tại khoá*, không kiểm tra bản dịch
- **Nhóm:** Test / false-confidence
- **Vị trí:** `tests/security-i18n.test.cjs:50-59`
```js
assert(viKeys.length >= 40, `VI dictionary must have sufficient keys (found ${viKeys.length})`);
assert(enKeys.length >= 40, `EN dictionary must have sufficient keys (found ${enKeys.length})`);
for (const k of viKeys) {
  assert(enKeys.includes(k), `Missing English translation for key: "${k}"`);
}
```
- **Bằng chứng:** kiểm chứng độc lập bằng Node:
```
vi keys: 80 en keys: 80
missing in en: 0
keys where vi value === en value (untranslated/identical): 3
about.title, about.qrLabel, about.paypalLabel
```
- **Tác động:** Nếu **toàn bộ** giá trị tiếng Anh bị ghi đè bằng tiếng Việt (i18n hỏng hoàn toàn) thì test **vẫn PASS**, vì chỉ so khớp *tập khoá*. 3 khoá hiện đã có giá trị giống nhau ở cả 2 ngôn ngữ mà test không phát hiện.
- **Khuyến nghị:** assert thêm `I18N.en[k]` là chuỗi không rỗng và (tuỳ chính sách) khác `I18N.vi[k]`; hoặc snapshot test.

### T-03 — [THẤP] Số liệu in ra không khớp số assertion thực tế
- **Nhóm:** Test / báo cáo sai
- **Vị trí:** `tests/security-i18n.test.cjs:35`
```js
console.log("✓ SSRF filter tests passed (14/14)");
```
- **Bằng chứng:** đếm thực tế bằng Node:
```
isSafeFetchUrl assertions in file: 17
message printed: SSRF filter tests passed (14/14)
```
- **Tác động:** báo cáo "14/14" gây hiểu nhầm về độ phủ; không ảnh hưởng đúng/sai nhưng làm mất lòng tin vào log.
- **Khuyến nghị:** đếm bằng biến và in số thật, hoặc bỏ con số cứng.

### T-04 — [CAO] Bộ test SSRF bỏ sót các dạng loopback bypass (đã chứng minh bằng thực thi)
- **Nhóm:** Test / thiếu phủ — **bảo mật**
- **Vị trí:** `tests/security-i18n.test.cjs:16-34`; hàm nguồn `background.js:264-291`
- **Bằng chứng:** trích `isSafeFetchUrl` bằng `new Function` (đúng như test làm) rồi thử thêm các URL **không có trong bộ test**:
```
"http://[::1]/admin"          => false
"http://[::ffff:127.0.0.1]/"  => true     <-- BYPASS
"http://2130706433/"          => false
"http://0x7f000001/"          => false
"http://0177.0.0.1/"          => false
"http://127.0.0.1.nip.io/"    => false
"http://localhost./"          => true     <-- BYPASS
"http://LOCALHOST:80/"        => false
"https://[::1]/"              => false
"http://①②⑦.0.0.1/"          => false
"http://0/"                   => false
"http://[0:0:0:0:0:0:0:1]/"   => false
```
- **Tác động:** test hiện **PASS** dù guard cho qua `http://[::ffff:127.0.0.1]/` (IPv4-mapped IPv6 loopback) và `http://localhost./` (FQDN có dấu chấm cuối). Kẻ tấn công dùng 2 dạng này để buộc SW `fetch()` vào endpoint nội bộ → SSRF. Test bảo mật không bắt được lỗi bảo mật.
- **Khuyến nghị:** thêm các vector trên vào bộ test (chúng sẽ FAIL → buộc sửa guard): chuẩn hoá host (bỏ dấu chấm cuối), chặn dải `::ffff:0:0/96` và `::/128`, chặn CGNAT `100.64/10`, phân giải DNS trước khi cho qua.

### T-05 — [TRUNG BÌNH] Harness integration vô hiệu hoá `setInterval`/`clearInterval` → ticker 2FA & heartbeat không được test
- **Nhóm:** Test / thiếu phủ
- **Vị trí:** `tests/integration.test.cjs:960-967`
```js
    setTimeout,
    clearTimeout,
    // start2FaTicker / vaultHeartbeat would keep the process alive otherwise
    setInterval: () => 0,
    clearInterval: () => {},
```
- **Bằng chứng:** `popup.js:1305` (`vaultHeartbeat = setInterval(..., 20000)`) và `popup.js:2197` (`tickerInterval = setInterval(..., 1000)`) đều bị thay bằng no-op trong test.
- **Tác động:** hai cơ chế quan trọng về *thời gian/sống còn phiên* — gia hạn khoá phiên 20 s và cập nhật mã TOTP 1 s — **không hề được thực thi** trong toàn bộ suite. Regression ở đây sẽ không bị phát hiện.
- **Khuyến nghị:** thay bằng fake timers có thể `advance()` để kiểm tra nhịp heartbeat và việc ticker chỉ re-render khi tab 2FA đang active.

### T-06 — [TRUNG BÌNH] `fetch` bị stub → luồng kiểm tra cập nhật (`checkForUpdates`) không được test
- **Nhóm:** Test / thiếu phủ
- **Vị trí:** `tests/integration.test.cjs:968`
```js
    fetch: () => Promise.resolve({ ok: false, status: 0, json: () => Promise.resolve({}) }),
```
- **Tác động:** `background.js:673-707` (`checkForUpdates`) và nhánh badge "NEW"/`genUpdateInfo` **không được kiểm thử**.
- **Khuyến nghị:** stub `fetch` trả manifest version cao hơn và assert badge + `genUpdateInfo.hasUpdate === true`.


### T-07 — [TRUNG BÌNH] Cơ chế "declared-defect" có thể che regression mới
- **Nhóm:** Test / false-confidence
- **Vị trí:** `tests/integration.test.cjs:1146-1148`, `1741-1752`
```js
const bugFails = fails.filter((c) => c.bugId);
const realFails = fails.filter((c) => !c.bugId);
const status = fails.length === 0 ? "PASS" : (realFails.length === 0 ? "PASS (known defects reproduced)" : "FAIL");
...
emit("  exit code        : " + (unexpected === 0 ? "0" : "1") + " (a declared-defect reproduction does not fail the suite)");
```
- **Bằng chứng:** check gắn tag `BUG-1`/`BUG-2` (`integration.test.cjs:1259-1266`, `1323-1336`) **không bao giờ** làm suite fail; hiện cả 2 đều "not reproduced".
- **Tác động:** nếu sau này xuất hiện một lỗi *khác* rơi đúng vào check có tag BUG, nó vẫn bị báo là "declared-defect reproduction" và **exit code vẫn 0**. Cơ chế hợp lý để tài liệu hoá lỗi đã biết, nhưng là bề mặt che giấu nếu tag bị đặt sai/nhầm.
- **Khuyến nghị:** thêm thời hạn `expiresAt` cho mỗi BUG; khi một BUG "not reproduced" quá N lần chạy thì tự động chuyển tag thành hard-fail.

### T-08 — [CAO] `e2e-chrome.cjs` là test **duy nhất** chạy Chrome thật, nhưng không chạy được trong CI/máy này
- **Nhóm:** Test / thiếu phủ môi trường
- **Vị trí:** `tests/e2e-chrome.cjs:30`, `:234`, `:507`
- **Bằng chứng:** mục 1.4 — `spawn /usr/bin/google-chrome ENOENT` → `FATAL ... injectExtensionIntoProfile (…:234:39)` → `EXIT CODE: 1`.
- **Tác động:** toàn bộ hành vi **đặc thù MV3** chỉ được kiểm chứng ở đây: CSP `'wasm-unsafe-eval'` cho Argon2id trong popup thật, vòng đời service worker (S5/S6/S7), `storage.session` bị xoá khi restart, hành vi nhiều popup + port `vault-session` (S4), content-script relay trên trang thật (S9). 12 scenario **KHÔNG XÁC MINH ĐƯỢC** ở đây.
- **Khuyến nghị:** pin Chrome trong CI (`chrome-for-testing`), set `E2E_CHROME`; coi e2e chạy được là điều kiện bắt buộc trước release. **Không** dùng `E2E_SKIP_IDLE=1` như bằng chứng pass (xem T-09).

### T-09 — [TRUNG BÌNH] `E2E_SKIP_IDLE=1` biến việc bỏ qua thành "pass"
- **Nhóm:** Test / false-confidence
- **Vị trí:** `tests/e2e-chrome.cjs:727-730` và `:821-824`
```js
c.assert("bo qua co y tu nguoi dung (khong tinh FAIL)", true, "E2E_SKIP_IDLE=1");
```
- **Tác động:** S5 (idle 40 s qua SW restart) và S7 (restart trình duyệt) bị bỏ nhưng vẫn ghi một check `ok` → bảng tổng kết vẫn "xanh". Người đọc log dễ tưởng đã phủ.
- **Khuyến nghị:** đánh dấu SKIP riêng (không tính vào `ok`), và in cảnh báo trong summary khi có SKIP.

### T-10 — [THẤP] Ngưỡng perf P1 quá lỏng
- **Nhóm:** Test / ngưỡng
- **Vị trí:** `tests/vault.test.cjs:328-335`
```js
assert.ok(ms < 5000, `unlock should be < 5s, took ${ms.toFixed(1)} ms`);
```
- **Bằng chứng:** đo thực tế Argon2id `m=65536 t=3 p=4` ≈ **239–265 ms** (mục 3.6). Ngưỡng 5000 ms rộng gấp ~20 lần.
- **Tác động:** một hồi quy hiệu năng 10–20× (vô tình tăng `t`/`m`, hoặc mất WASM) vẫn **PASS**.
- **Khuyến nghị:** tách ngưỡng "cứng" (ví dụ < 1500 ms) và ghi lại số đo vào log; cảnh báo (không fail) khi vượt baseline.

### T-11 — [THẤP] Không có runner/CI, không có `package.json`
- **Nhóm:** Test / hạ tầng
- **Bằng chứng:**
```
$ ls package.json
NO package.json
$ ls -la .github
NO .github
```
- **Tác động:** không có `npm test`, không có pipeline; 4 file test không được ràng buộc vào cổng kiểm soát nào.
- **Khuyến nghị:** thêm `package.json` với script `test` gọi 3 suite chạy được, và workflow CI (kèm Chrome cho e2e).

### Bảng tổng hợp mức độ phủ / false-confidence

| Vùng code rủi ro | Được test? | Ghi chú |
|---|---|---|
| `vault.js` (crypto core, AAD, tamper, KAT) | ✅ tốt | `vault.test.cjs` — chất lượng cao, KAT Argon2id thật |
| popup ⇄ SW (enable/unlock/relock/idle/relay) | ✅ tốt (vm) | `integration.test.cjs` 105 checks |
| `isSafeFetchUrl` (SSRF) | ⚠️ một phần | thực thi thật nhưng **thiếu** vector bypass (T-04) |
| Rate-limit PIN | ❌ | chỉ `String.includes` (T-01) |
| i18n | ⚠️ yếu | chỉ kiểm khoá (T-02) |
| Ticker 2FA / heartbeat phiên | ❌ | `setInterval` bị stub (T-05) |
| `checkForUpdates` | ❌ | `fetch` bị stub (T-06) |
| MV3 thật (CSP wasm, SW restart, storage.session) | ❌ ở đây | e2e không chạy được (T-08) |
| QR decode (`jsqr.js`, `decode_image_element`) | ❌ | không suite nào gọi `jsQR` |

---


## 3. Hiệu năng / tối ưu hoá

### 3.0 Kích thước asset & tỉ trọng bundle (số byte chính xác)

Lệnh: `stat -c '%s %n'` + tính tỉ trọng bằng Node.

**Bộ tải của trang popup** (`popup.html` nạp `popup.css` + `hash-wasm.umd.js` + `vault.js` + `jsqr.js` + `wordlist.js` + `popup.js`):
```
POPUP PAGE total: 676064 bytes
   5.3%  35926  popup.html
   6.5%  43952  popup.css
  24.5% 165316  popup.js
   0.9%   6146  vault.js
  19.3% 130757  jsqr.js
   1.5%  10301  wordlist.js
  42.0% 283666  vendor/hash-wasm.umd.js
```
**Content script tiêm vào MỌI trang http/https** (`manifest.json:32-40` → `jsqr.js`, `content.js` + `content.css`):
```
CONTENT SCRIPT (per page) total: 169000
  77.4% 130757  jsqr.js
  18.7%  31648  content.js
   3.9%   6595  content.css
```
**`importScripts` của service worker** (`background.js:3-21`):
```
SERVICE WORKER importScripts total: 430870
  65.8% 283666  vendor/hash-wasm.umd.js
  30.3% 130757  jsqr.js
   2.4%  10301  wordlist.js
   1.4%   6146  vault.js
```
Tổng asset ship (không kể `icons/`, 1.4 KB): **738 989 byte ≈ 722 KB**.

### P-01 — [CAO] `vault.js` ghi sai **cả size lẫn sha256** của `vendor/hash-wasm.umd.js`
- **Nhóm:** Chuỗi cung ứng / toàn vẹn
- **Vị trí:** `vault.js:7-8`
```
//   file:   vendor/hash-wasm.umd.js  (283696 bytes)
//   sha256: 4c623029dcde56c12ae2dc290f90e616cfeb4734e23575bb08c01cdeac3acbe3
```
- **Bằng chứng:** đo thực tế:
```
$ stat -c '%s %n' vendor/hash-wasm.umd.js
283666 vendor/hash-wasm.umd.js
$ sha256sum vendor/hash-wasm.umd.js
bf24100d2dbbad074b152065790c7aacaef8369ac6a8461ca768ce79592902eb  vendor/hash-wasm.umd.js
```
  Size ghi **283696** ≠ thực **283666** (lệch 30 byte). sha256 ghi `4c6230…` ≠ thực `bf2410…`. Không có file nào trong repo (kể cả README/NOTICE) chứa hash tham chiếu khác để đối chiếu.
- **Tác động:** hash pin **vô dụng** để xác minh toàn vẹn/nguồn gốc của WASM Argon2id — thành phần nhạy cảm nhất (nhận PIN, sinh khoá). Không thể phân biệt "lỗi tài liệu" với "file đã bị thay đổi". (Ghi nhận: `audit/security.md` cũng đã nêu điểm này — ở đây xác nhận độc lập bằng phép đo.)
- **Khuyến nghị:** tính lại `sha256sum` + `stat`, cập nhật `vault.js:7-8`; thêm script CI kiểm hash (fail build nếu lệch) và pin hash cho `jsqr.js`/`wordlist.js`.

### P-02 — [CAO] `jsqr.js` (130 KB, 77 % content-script) bị tiêm vào **mọi trang**, nhưng chỉ dùng khi người dùng bấm giải mã QR
- **Nhóm:** Kích thước bundle / chi phí mỗi trang
- **Vị trí:** `manifest.json:32-40` (`content_scripts.js: ["jsqr.js","content.js"]`), dùng tại `content.js:707-708`
```js
if (typeof jsQR === "function") {
  const code = jsQR(imgData.data, width, height, { inversionAttempts: "attemptBoth" });
```
- **Bằng chứng:** `jsqr.js` = 130 757 byte (10 dòng, đã minify), chiếm **77.4 %** payload content script; nó chỉ được gọi trong nhánh xử lý message `decode_image_element` (hành động từ context menu) — tức là **theo yêu cầu**, không phải trên đường tải trang.
- **Tác động:** mỗi lần điều hướng trên bất kỳ trang http/https nào, Chrome phải **fetch + parse + compile 130 KB JS** cho một tính năng QR hiếm khi dùng → chậm thời gian tải trang, tốn CPU/RAM mỗi tab.
- **Khuyến nghị:** bỏ `jsqr.js` khỏi `content_scripts`; chỉ tiêm khi cần bằng `chrome.scripting.executeScript({ files:["jsqr.js"] })` khi người dùng bấm "Quét QR", hoặc chuyển việc decode sang offscreen document / service worker.

### P-03 — [CAO] Ticker 2FA dựng lại toàn bộ DOM + tính lại HMAC **mỗi 1000 ms**
- **Nhóm:** DOM / CPU định kỳ
- **Vị trí:** `popup.js:2195-2202` (ticker) → `popup.js:2062-2192` (`render2FA`)
```js
function start2FaTicker() {
  if (tickerInterval) clearInterval(tickerInterval);
  tickerInterval = setInterval(() => {
    if (els.view2Fa.classList.contains("active")) {
      render2FA();          // dựng lại TOÀN BỘ danh sách
    }
  }, 1000);
}
```
  và trong vòng lặp `render2FA`: `els.list2Fa.innerHTML = "";` (`popup.js:2064`) rồi với **từng** item `await generateTotp(item.secret, nowSec)` (`popup.js:2121`) + tạo ~15 node/item.
- **Tác động:** khi tab 2FA đang mở, cứ mỗi giây: (a) xoá + tạo lại toàn bộ card (layout/paint lại), (b) chạy N lần `crypto.subtle.importKey` + `sign` HMAC-SHA1 **tuần tự** (`popup.js:711-719`), (c) gắn lại toàn bộ listener. Mã TOTP chỉ đổi mỗi 30 s → lãng phí ~30×. `render2FA` là `async` gọi từ `setInterval` **không await** → có thể chồng lấn nếu render > 1 s.
- **Khuyến nghị:** chỉ cập nhật text mã + thanh tiến trình mỗi giây (giữ nguyên node), tính lại HMAC **một lần mỗi 30 s** (hoặc cache theo `counter`), dùng `requestAnimationFrame` và bỏ re-render khi `Math.floor(t/30)` không đổi.

### P-04 — [CAO] Khuếch đại ghi storage: mỗi bước kéo slider ghi `genOptions` một lần
- **Nhóm:** Ghi storage / per-input
- **Vị trí:** `popup.js:2510-2513` và `popup.js:2497-2500` → `handleGenerate(false)` → `saveOptions(opts)` (`popup.js:2470`, `2447`) → `chrome.storage.local.set({ genOptions: opts })` (`popup.js:1223-1227`)
```js
els.lengthRange.addEventListener("input", (e) => {
  els.lengthVal.textContent = e.target.value;
  handleGenerate(false);      // -> saveOptions() -> storage.local.set
});
```
- **Tác động:** kéo thanh độ dài 8→64 phát sinh ~56 sự kiện `input` → **56 lần `chrome.storage.local.set`** (mỗi lần serialize + ghi đĩa + phát `onChanged`). Các control khác (`optUpper`, `minNumbers`, `passphrase-separator`, …) cũng gọi `handleGenerate` khi `change`.
- **Khuyến nghị:** debounce ~150–300 ms cho các handler `input`/`change` sinh mật khẩu; chỉ ghi storage sau khi người dùng ngừng thao tác.


### P-05 — [CAO] Khi bật vault: mỗi lần lưu 1 mục **mã hoá lại toàn bộ blob** và **tự kích hoạt decrypt + re-render toàn bộ**
- **Nhóm:** Crypto / storage / re-render
- **Vị trí:** `popup.js:1587-1601` (`persist`) + `popup.js:4274-4310` (`onChanged`)
```js
async function persist(key, value) {
  if (!vaultOn || !vaultKey || !vaultBlob) { chrome.storage.local.set({ [key]: value }); return; }
  vaultData[key] = value;
  const blob = await GPVault.reencrypt(vaultData, vaultKey, { salt: vaultBlob.salt, t: ..., m: ..., p: ... });
  vaultBlob = blob;
  await chrome.storage.local.set({ genVault: blob });   // ghi lại TOÀN BỘ kho
}
```
  và listener trong **chính popup** nhận sự kiện `genVault` do mình vừa ghi:
```js
if (vaultOn && vaultKey) {
  if (!changes.genVault) return;
  GPVault.decryptBlob(changes.genVault.newValue, vaultKey)
    .then(data => { ... renderTags(); updateHistoryUI(); render2FA(); renderCards(); renderCookieProfiles(); });
```
- **Tác động:** một thao tác lưu nhỏ (copy 1 mật khẩu → `saveHistoryItem` → `persistKey("genHistory")`) kéo theo: **re-encrypt toàn bộ `vaultData`** (cả 5 mảng) → ghi toàn blob → `onChanged` → **decrypt toàn blob** → **render lại 5 danh sách**. Chi phí O(tổng dữ liệu) mỗi lần lưu, **nhân đôi** công việc do feedback loop. Với 200 mục lịch sử + thẻ + cookie, blob ngày càng lớn.
- **Khuyến nghị:** (a) bỏ qua `onChanged` khi thay đổi đến từ chính popup (đánh dấu `lastWriteAt`/token); (b) debounce `persist`; (c) chỉ re-render view đang hiển thị thay vì cả 5.

### P-06 — [CAO] Argon2id (~250 ms) **chặn main thread** popup — không có Worker
- **Nhóm:** UX / chặn UI
- **Vị trí:** `vault.js:19-21` (`PARAMS { iterations:3, memorySize:65536, parallelism:4, hashLength:32 }`), gọi tại `popup.js:1392/1440/1459/1482`; vendor `vendor/hash-wasm.umd.js`
- **Bằng chứng:**
```
$ node -e 'const V=require("./vault.js"); ... await V.hashSecret("abcd1234",salt)'
hashSecret (Argon2id m=65536 t=3 p=4) ms: 250, 244, 239
```
  và từ chính `vault.test.cjs`: `unlockWithPin took 265.4 ms`. Kiểm tra vendor **không có Worker**:
```
$ grep -c 'Worker' vendor/hash-wasm.umd.js
0
$ grep -o 'WebAssembly\.[a-zA-Z]*' vendor/hash-wasm.umd.js | sort | uniq -c
      1 WebAssembly.compile
      1 WebAssembly.instantiate
```
- **Tác động:** hash-wasm chạy WASM **trên main thread**; `await` chỉ bọc một phép tính WASM đồng bộ → trong ~250 ms (máy yếu có thể 0.5–1 s) **UI popup đứng hoàn toàn** (nút "Đang lưu…", không có phản hồi). Mức CPU chấp nhận được về bảo mật (OWASP 64 MiB), nhưng cách gọi làm mất mượt UX.
- **Khuyến nghị:** giữ nguyên tham số Argon2id (an toàn) nhưng chạy KDF trong Web Worker / offscreen document để không chặn UI; hiển thị spinner thật sự khi chờ. (Nếu chuyển sang Worker, kiểm thử lại CSP `'wasm-unsafe-eval'`.)

### P-07 — [TRUNG BÌNH] Không có debounce/throttle/`requestAnimationFrame` ở bất kỳ đâu
- **Nhóm:** Xử lý sự kiện
- **Bằng chứng:**
```
$ grep -rn -i 'debounce|requestAnimationFrame|throttle' popup.js content.js background.js
(no output — exit 1)
```
- **Vị trí tiêu biểu:** `popup.js:2552` (`input-search-history` → `updateHistoryUI()` mỗi phím), `popup.js:3719` (`input-search-cards` → `renderCards()` mỗi phím), `popup.js:4250` (`input-search-cookies` → `renderCookieProfiles()` mỗi phím), `popup.js:3622/3630` (card number/expiry), `popup.js:2497/2510` (slider).
- **Tác động:** mỗi ký tự gõ vào ô tìm kiếm dựng lại **toàn bộ** danh sách (lịch sử/thẻ/cookie) — O(n) node DOM mỗi phím; gõ nhanh gây giật, đặc biệt khi danh sách dài (lịch sử tối đa 200 mục — `popup.js:1788`).
- **Khuyến nghị:** debounce ô tìm kiếm (~120 ms), throttle các handler `input` nặng; hoặc cập nhật gia tăng thay vì `innerHTML = ""`.

### P-08 — [TRUNG BÌNH] Layout thrash: `getBoundingClientRect()` trong listener `scroll`/`resize` của content script
- **Nhóm:** Layout thrash / content script
- **Vị trí:** `content.js:164-177`
```js
function updateBadgePosition() {
  const rect = passInput.getBoundingClientRect();   // forced synchronous layout
  ...
  badge.style.top = `${window.scrollY + rect.top + ...}px`;
  badge.style.left = `${window.scrollX + rect.right - 26}px`;
}
updateBadgePosition();
window.addEventListener("resize", updateBadgePosition);
window.addEventListener("scroll", updateBadgePosition);
```
- **Tác động:** mỗi sự kiện `scroll` (bắn liên tục) buộc **đọc layout đồng bộ** (`getBoundingClientRect`) ngay sau khi ghi style ở frame trước → **forced reflow / layout thrash** trên trang đang duyệt. Listener được thêm **cho từng ô mật khẩu** và **không bao giờ được gỡ** (không có `removeEventListener`, badge không bị `remove()`); trang nhiều form → nhiều listener cùng đọc layout mỗi frame.
- **Khuyến nghị:** bọc trong `requestAnimationFrame` (coalesce), dùng `position: fixed` để không cần `scrollY/scrollX`, và gỡ listener khi badge bị loại bỏ/`pagehide`.

### P-09 — [TRUNG BÌNH] Service worker re-spawn phải parse lại 430 KB `importScripts`
- **Nhóm:** Vòng đời service worker
- **Vị trí:** `background.js:3-21`
```
importScripts("vendor/hash-wasm.umd.js"); // 283 666 B
importScripts("vault.js");                //   6 146 B
importScripts("jsqr.js");                 // 130 757 B
importScripts("wordlist.js");             //  10 301 B
```
- **Tác động:** MV3 SW bị dừng sau ~30 s nhàn rỗi; **mỗi** lần đánh thức (context menu, message, alarm, mở popup) phải fetch+parse **430 870 byte**. Trong đó `jsqr.js` (130 KB, 30 %) chỉ dùng cho `decodeQrFromUrl` (`background.js:296-334`) và `wordlist.js` (10 KB) chỉ cho `generatePassphraseWords` — cả hai **hiếm khi** gọi từ SW. Chi phí lặp lại này làm chậm cold-start mọi tương tác.
- **Khuyến nghị:** chỉ `importScripts` vendor + `vault.js` ở top-level; nạp `jsqr.js`/`wordlist.js` **lazy** (chỉ khi chức năng tương ứng được gọi).


### P-10 — [THẤP] `popup.html` nạp 5 script **đồng bộ**, chặn paint (283 KB hash-wasm trước lần vẽ đầu)
- **Nhóm:** Render-blocking
- **Vị trí:** `popup.html:7` (`<link rel="stylesheet" href="popup.css">`) và `popup.html:689-693`
```html
<script src="vendor/hash-wasm.umd.js"></script>
<script src="vault.js"></script>
<script src="jsqr.js"></script>
<script src="wordlist.js"></script>
<script src="popup.js"></script>
```
- **Tác động:** các `<script>` không có `defer`/`async` → trình duyệt phải fetch + thực thi lần lượt **676 KB** (chủ yếu 283 KB hash-wasm + 130 KB jsqr) trước khi DOM hoàn tất; popup chỉ "hiện" sau đó. Popup mở/đóng thường xuyên nên độ trễ này cảm nhận rõ.
- **Khuyến nghị:** `defer` cho script không cần trước paint; nạp `jsqr.js` lazy (chỉ khi mở QR); cân nhắc tách `popup.js` 165 KB thành module nhỏ.

### P-11 — [THẤP] Code & CSS chết
- **Nhóm:** Dead code
- **Vị trí:**
  - `popup.js:47-62` — `function validateLuhn(num)` **định nghĩa nhưng không được tham chiếu** trong `popup.js` (bản dùng thật nằm ở `content.js:330`). Kiểm chứng bằng quét hàm:
    ```
    functions: 98 | defined-but-never-referenced: 1
    validateLuhn
    ```
  - `popup.css` — 6 class định nghĩa nhưng **không** xuất hiện trong `popup.html` lẫn `popup.js`:
    ```
    classes not referenced in html or js: 6
    history-url, brand-visa, brand-mastercard, brand-jcb, brand-amex, brand-napas
    ```
- **Tác động:** nhỏ về kích thước (vài KB CSS + ~15 dòng JS) nhưng gây nhiễu bảo trì và tạo ảo giác về độ phủ tính năng (CSS brand thẻ không được áp dụng).
- **Khuyến nghị:** xoá `validateLuhn` khỏi `popup.js` và 6 class chết, hoặc áp dụng chúng cho đúng nơi.

### P-12 — [TRUNG BÌNH] `NOTICE` thiếu khai báo hash-wasm (MIT) dù có ship `vendor/hash-wasm.umd.js`
- **Nhóm:** Chuỗi cung ứng / giấy phép
- **Vị trí:** `NOTICE` (chỉ có mục 1. jsQR, 2. EFF wordlist)
- **Bằng chứng:**
```
$ grep -in 'hash-wasm|hashwasm|Dani Biro|argon' NOTICE
NO hash-wasm entry in NOTICE
$ grep -in 'jsqr|hash-wasm|EFF|third' LICENSE
no third-party mentions in LICENSE
```
  Trong khi header file vendor ghi `(c) Dani Biro @license MIT` và `vault.js:4-6`, README cũng nêu `hash-wasm (MIT)`.
- **Tác động:** thiếu attribution cho một thành phần MIT đã ship (283 KB). MIT yêu cầu giữ bản quyền + giấy phép; header inline có giữ, nhưng `NOTICE` được tạo ra để liệt kê third-party lại **bỏ sót** → tài liệu không nhất quán với thực tế bundle.
- **Khuyến nghị:** thêm mục "3. hash-wasm 4.12.0 (MIT, © Dani Biro)" vào `NOTICE` kèm URL nguồn + hash đúng (sửa P-01).

### P-13 — [THẤP] Heartbeat ghi `storage.session` mỗi 20 s khi popup mở
- **Nhóm:** Ghi storage
- **Vị trí:** `popup.js:1301-1308`
```js
vaultHeartbeat = setInterval(() => {
  if (vaultKey) vaultSessionSet(vaultKey, min).catch(() => {});
}, 20000);
```
- **Tác động:** cứ 20 s ghi lại `{ genVaultKey: {k, exp} }` vào `storage.session`. Nhỏ (chỉ 1 khoá), nhưng là ghi định kỳ không cần thiết nếu đã có cơ chế kiểm tra `exp` khi đọc (`background.js:355`).
- **Khuyến nghị:** chỉ gia hạn khi có hoạt động thực (người dùng tương tác), hoặc tăng chu kỳ; hiện đã `clearInterval` đúng chỗ nên không rò rỉ.

### P-14 — [THẤP] Vòng kết nối lại port `vault-session` không có giới hạn
- **Nhóm:** Vòng đời / rò rỉ
- **Vị trí:** `popup.js:1286-1298`
```js
vaultPort.onDisconnect.addListener(() => {
  vaultPort = null;
  if (vaultOn) setTimeout(() => { if (vaultOn) vaultPortConnect(); }, 500);
});
```
- **Tác động:** nếu SW liên tục bị kill (MV3 idle) thì popup thử kết nối lại mỗi 500 ms vô hạn trong lúc popup mở. Có điều kiện `vaultOn` nên bị chặn, nhưng không có backoff → nếu SW crash-loop thì sinh tải.
- **Khuyến nghị:** thêm backoff lũy tiến + số lần thử tối đa.

### P-15 — [THÔNG TIN] `popup.js` là một file 165 KB / 4 349 dòng, 139 `addEventListener`
- **Nhóm:** Kiến trúc / khả năng tối ưu
- **Bằng chứng:** `wc -l popup.js` = 4349; `grep -c addEventListener popup.js` = 139; `getElementById` xuất hiện 164 lần; 72 lời gọi render/update (`updateHistoryUI|renderCards|render2FA|renderCookieProfiles|renderTags|renderTagFilterBar`).
- **Tác động:** mỗi lần init popup cache `els` một lần (tốt), nhưng khối lượng render toàn cục + nhiều listener làm khó tách nhỏ và khó lazy-load; cũng là gốc của P-03/P-04/P-05.
- **Khuyến nghị:** tách view (gen/history/2fa/cards/cookies/about) thành module, render từng phần; đây là tiền đề để sửa P-03..P-05 sạch sẽ.

---


## 4. Nguồn gốc dependency & giấy phép

| Asset | Kích thước | Nguồn (theo header/comment) | Giấy phép | Ghi trong NOTICE? | Hash pin? |
|---|---|---|---|---|---|
| `vendor/hash-wasm.umd.js` | 283 666 B | `hash-wasm@4.12.0` (jsDelivr, `dist/index.umd.js`) — `vault.js:4-8` | MIT © Dani Biro | ❌ **THIẾU** (P-12) | ⚠️ **SAI** (P-01) |
| `jsqr.js` | 130 757 B | `jsqr@1.4.0` minify bằng jsDelivr Terser v5.39.0 (header `jsqr.js:1-9`) | Apache-2.0 © 2018 Lazar Laszlo | ✅ mục 1 | ❌ không có |
| `wordlist.js` | 10 301 B | EFF `eff_short_wordlist_1.txt` (`wordlist.js:1-5`) | CC BY (EFF) | ✅ mục 2 | ❌ không có |
| `popup.css` | 43 952 B | nội bộ | MIT (repo) | n/a | n/a |
| `popup.js` | 165 316 B | nội bộ | MIT (repo) | n/a | n/a |

**Xác minh "thật hay stub":**
- `jsqr.js` — **KHÔNG phải stub**, là bản thật đã minify (10 dòng vì Terser gộp 1 dòng). Bằng chứng: `require("/workspace/jsqr.js")` trả `typeof jsQR: function`.
- `wordlist.js` — **KHÔNG phải stub**: mảng thật, 1 296 từ, 0 trùng:
  ```
  words: 1296
  dupes: 0
  ```
- `vendor/hash-wasm.umd.js` — **KHÔNG phải stub**: có `WebAssembly.instantiate` + `WebAssembly.compile`, chạy được KAT (vault.test K1 pass).

**Hash thực tế (dùng để pin lại):**
```
bf24100d2dbbad074b152065790c7aacaef8369ac6a8461ca768ce79592902eb  vendor/hash-wasm.umd.js
d0e34678db3748e2b774ec752e71ad3822a73d5321ca76abae0b4461a0b95b67  jsqr.js
149913c0061ef27c70b88dc3a4cb80af5e6fbec2564b043b242977f1c75c09ae  wordlist.js
```

**KHÔNG XÁC MINH ĐƯỢC:** liệu `jsqr.js`/`wordlist.js` có khớp **byte-for-byte** với bản phát hành chính thức trên npm/EFF hay không (máy này không có mạng để tải bản tham chiếu). Header tự khai nguồn nhưng repo **không lưu** hash tham chiếu cho 2 file này.

---

## 5. Điểm tốt

1. **Bộ test crypto (`vault.test.cjs`) chất lượng cao thật sự.** Thực thi `vault.js` thật (không regex source), có **Known-Answer Test Argon2id** đối chiếu vector tham chiếu (K1), kiểm tra AAD bị ràng buộc (A10), phát hiện giả mạo cả `ct`/`iv`/`salt` (A4), roundtrip payload 200 KB + tiếng Việt/emoji (A9), và kiểm tra đường thiếu vendor → `GPVAULT_NO_KDF` bằng **tiến trình con** (N1). Đây là mức kiểm thử mà nhiều dự án không có.
2. **`integration.test.cjs` chạy popup.js + background.js thật trong `node:vm`**, chia sẻ một `chrome` giả + một storage, mở realm popup mới cho từng flow. Thực sự **thực thi** 105 check trên 10 flow, ghi lại bằng chứng từng check và liệt kê đúng 21 API Chrome đã chạm → độ tin cậy cao, không phải test hình thức.
3. **Tài liệu hoá lỗi nguồn một cách trung thực:** registry `BUG-1/BUG-2` (integration) và `OBS-1` kèm `file:line` + tác động; cơ chế "NOT VERIFIED"/"NOT OBSERVED" thay vì giả PASS. `e2e-chrome.cjs:53` ghi rõ "không chạy được -> ghi NOT VERIFIED".
4. **Không lạm dụng `!important`:** `popup.css` chỉ có **4** `!important` trên 1 473 khai báo — kỷ luật CSS tốt.
5. **Không có CSS chặn tải do ảnh nặng:** `popup.css` có **0** `url()` và **0** `data:` URI → không có asset nhúng làm phình CSS.
6. **Có ý thức về rò rỉ bộ nhớ/timer:** các chỗ tạo interval đều `clearInterval` trước khi tạo lại (`popup.js:1302`, `popup.js:2196`), port được `disconnect()` khi dừng (`popup.js:1315-1322`), `onDisconnect` xử lý SW bị kill.
7. **Vault dùng KDF mạnh đúng chuẩn:** Argon2id `m=64 MiB, t=3, p=4`, AES-256-GCM **có AAD** ràng buộc blob, `reencrypt` giữ salt ổn định và xoay IV mỗi lần mã hoá (được test A5). Đánh đổi hiệu năng ~250 ms là **chấp nhận được** về bảo mật; vấn đề chỉ là nó chặn main thread (P-06).
8. **Provenance của hash-wasm được ghi lại tường minh** (nguồn npm, version, license, kích thước, sha256) trong `vault.js` — đúng tinh thần pin supply-chain; chỉ cần **sửa số liệu sai** (P-01) là hoàn chỉnh.
9. **Có kiểm thử hiệu năng** (P1 trong vault.test) dù ngưỡng còn lỏng — ý thức về perf đã có.
10. **`.gitignore` sạch**, `LICENSE` (MIT) và `NOTICE` tồn tại và có cấu trúc; icons rất nhẹ (16/48/128 px = 175/364/888 B).

---

## 6. Phụ lục — Lệnh đã dùng (tái lập)

```bash
# 1) Chạy test
cd /workspace
time node tests/security-i18n.test.cjs      # PASS, exit 0, 0.031s
time node tests/vault.test.cjs              # PASS 15/15, exit 0, 7.444s
time node tests/integration.test.cjs        # PASS 10 flows/105 checks, exit 0, 15.289s
node tests/e2e-chrome.cjs                   # FATAL (spawn /usr/bin/google-chrome ENOENT), exit 1

# 2) Kích thước & hash
stat -c '%s %n' vendor/hash-wasm.umd.js jsqr.js wordlist.js popup.js popup.css
sha256sum vendor/hash-wasm.umd.js jsqr.js wordlist.js

# 3) Kiểm tra thật/stub
node -e 'const m=require("/workspace/jsqr.js");console.log(typeof m)'
node -e 'const s=require("fs").readFileSync("wordlist.js","utf8");console.log(JSON.parse(s.match(/\[[^\]]*\]/)[0]).length)'

# 4) Đo Argon2id
node -e 'const V=require("./vault.js");(async()=>{const s=V.randomBytes(16);for(let i=0;i<3;i++){const a=performance.now();await V.hashSecret("abcd1234",s);console.log((performance.now()-a).toFixed(0))}})()'

# 5) Kiểm tra bypass SSRF (trích hàm y như test làm)
node -e 'const fs=require("fs");const m=fs.readFileSync("background.js","utf8").match(/function isSafeFetchUrl\([\s\S]*?^}/m);const f=new Function("urlStr",m[0]+"\nreturn isSafeFetchUrl(urlStr);");console.log(f("http://[::ffff:127.0.0.1]/"),f("http://localhost./"))'

# 6) Đếm test
grep -c 'check(' tests/integration.test.cjs        # 106
grep -c 'c.ok(\|c.assert(' tests/e2e-chrome.cjs    # 149
```

**Giới hạn của audit này:**
- Không chạy được `e2e-chrome.cjs` (thiếu Chrome thật) → mọi kết luận về hành vi MV3 runtime (CSP wasm trong popup, SW restart, `storage.session`) là **suy luận từ code**, chưa được thực thi ở đây.
- Không có mạng → không đối chiếu byte `jsqr.js`/`wordlist.js` với bản phát hành gốc.
- Các số đo thời gian (Argon2id ~250 ms, parse JS) là trên **máy audit**, có thể khác trên máy người dùng; dùng làm mốc tương đối.
- `jsqr.js`/`wordlist.js` "10 dòng" là do minify/1-dòng — **không phải** stub; đã xác minh bằng thực thi.

