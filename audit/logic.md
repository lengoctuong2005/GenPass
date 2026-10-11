# Báo cáo Kiểm toán Logic Nghiệp vụ — GenPass (Chrome MV3)

| Trường | Giá trị |
| :--- | :--- |
| **Đối tượng** | GenPass — Trình tạo mật khẩu / TOTP / Kho mã hóa (Chrome Extension Manifest V3) |
| **Phiên bản** | `manifest.json` → `1.2.0` |
| **Commit** | `b4a9b7fdfd434f293ceed2367a19ed8cbdbf3066` (nhánh `main`) |
| **Ngày** | 2026-10-11 |
| **Phạm vi** | `popup.js` (4349 dòng), `background.js` (775), `content.js` (830), `vault.js` (183), `wordlist.js`, `manifest.json`, `README.md`, `task.md`, `tests/*.cjs` |
| **Phương pháp** | Đọc tĩnh toàn bộ mã nguồn + **chạy thực nghiệm 5 harness Node.js** trích nguyên văn hàm từ mã nguồn (không sửa mã) để chứng minh: lỗi bỏ rơi lớp ký tự, overstate entropy, treo vô hạn `secureRandomInt`, vector TOTP RFC 6238, bỏ qua tham số `otpauth://`, `saveHistoryItem` gộp nhầm mục, `validateExpiryDate` nhận thẻ hết hạn. |
| **Nguyên tắc** | Mọi phát hiện kèm `file:line` + trích mã nguyên văn. Chỗ không kiểm chứng được ghi rõ. **Không sửa mã nguồn.** |

> **Cách đọc báo cáo:** mỗi phát hiện gồm *ID · Mức độ · Danh mục · Vị trí · Bằng chứng (trích mã) · Tác động · Cách sửa*. Mã `L-xx` là cục bộ cho tài liệu này.

---

## 0. Tóm tắt điều hành

Phần lõi sinh số ngẫu nhiên (CSPRNG + rejection sampling), TOTP (SHA-1/6 số/30s) và lớp mã hóa vault (Argon2id 64 MiB + AES-256-GCM + AAD) **về cơ bản là đúng**. Tuy nhiên lớp *nghiệp vụ* có nhiều lỗi thật, trong đó đáng chú ý nhất:

1. **"Đảm bảo mỗi lớp ký tự được chọn đều xuất hiện" bị phá vỡ** khi `length` nhỏ hơn số ký tự bắt buộc — lớp ký tự bị cắt âm thầm (đã chứng minh: chọn đủ 4 lớp + `minSpecial=2`, `length=4` ⇒ mật khẩu **không hề có ký tự đặc biệt**).
2. **Chỉ số entropy/độ mạnh hiển thị sai** (dùng kích thước pool *yêu cầu*, bỏ qua `avoidAmbiguous` và bỏ qua việc lớp bị cắt) ⇒ có thể báo "Rất mạnh" cho mật khẩu yếu hơn thực tế.
3. **Lockout chống brute-force PIN chỉ nằm trong RAM popup** ⇒ đóng/mở lại popup là reset; không có tầng nào ràng buộc trong background. Claim "Chống Brute-force" trong README chỉ đúng trên danh nghĩa.
4. **Tự động xóa clipboard sau 30 giây không hoạt động**: thiếu quyền `clipboardRead` trong `manifest.json`, `navigator.clipboard.readText()` luôn reject và bị nuốt lỗi.
5. **`saveHistoryItem` gộp nhầm hai tài khoản khác site** nếu trùng mật khẩu ⇒ mất dữ liệu.
6. **`otpauth://` bỏ qua `digits`, `period`, `algorithm`** ⇒ tài khoản dùng 8 số / 60s / SHA-256 sẽ luôn hiện mã sai mà không cảnh báo.


### Bảng tổng hợp phát hiện

| ID | Mức độ | Danh mục | Tóm tắt | Vị trí |
| :--- | :--- | :--- | :--- | :--- |
| **L-01** | High | Generator | Bỏ rơi lớp ký tự khi `requiredChars.length > length` (cắt mảng âm thầm) | `popup.js:140-152` |
| **L-02** | High | History | `saveHistoryItem` gộp nhầm metadata 2 site khác nhau khi trùng mật khẩu | `popup.js:1743-1773` |
| **L-03** | High | TOTP | Bỏ qua `digits`/`period`/`algorithm` của `otpauth://` ⇒ mã luôn sai với tài khoản 8 số/60s/SHA-256 | `popup.js:701-762`, `background.js:210-260` |
| **L-04** | High | Vault PIN | Lockout chỉ trong RAM popup; bypass bằng cách đóng/mở popup | `popup.js:427-428,1404-1407` |
| **L-05** | High | Clipboard | Không có quyền `clipboardRead` ⇒ auto-clear 30s không bao giờ chạy | `manifest.json:17-24`, `popup.js:966-980` |
| **L-06** | Medium | Entropy | `getActivePoolSize` bỏ qua `avoidAmbiguous` + bỏ qua lớp bị cắt ⇒ entropy báo cao hơn thực | `popup.js:1188-1195,2463-2468` |
| **L-07** | Medium | Generator | `minNumbers`/`minSpecial` vượt `length` bị bỏ qua âm thầm; `min` thực tế luôn ≥ 1 | `popup.js:119-132,140-150` |
| **L-08** | Medium | Vault | `persist()` ghi **plaintext** khi vault bật nhưng đang khóa | `popup.js:1587-1591` |
| **L-09** | Medium | Vault | Lost-update: popup và background mỗi bên mã hóa lại snapshot riêng của mình | `popup.js:1592-1600`, `background.js:371-388` |
| **L-10** | Medium | Storage | Chế độ plaintext/vault dùng chung tên khóa, không có version marker; trạng thái hỗn hợp có thể xảy ra | `background.js:333-401`, `popup.js:1587-1601` |
| **L-11** | Medium | Vault | `genOptions.vaultEnabled` suy ra từ checkbox UI ⇒ có thể lật mode vault→plaintext | `popup.js:1216,1223-1227,343` |
| **L-12** | Medium | History | Dedup chỉ so với mục đầu tiên ⇒ lưu trùng không liền kề; dedup theo mật khẩu ⇒ hai tài khoản khác nhau cùng mật khẩu bị coi là 1 | `popup.js:1743-1746` |
| **L-13** | Medium | TOTP | `base32Decode` bỏ qua ký tự sai âm thầm; validate chỉ `decoded.length === 0` | `popup.js:678-699,3166-3170` |
| **L-14** | Medium | Autofill | Khớp domain "mờ" theo tên + guard kiểm `matching[0]` có thể lệch với mục được điền | `content.js:655-691` |
| **L-15** | Medium | Autofill | Điền cùng 1 credential vào **mọi** ô password (kể cả "mật khẩu mới"/"xác nhận") | `content.js:154-195` |
| **L-16** | Medium | Cards | Form thẻ trong popup **không** gọi `validateLuhn` (hàm chết) ⇒ lưu số thẻ sai; README claim có Luhn | `popup.js:47-62,3642-3653` |
| **L-17** | Medium | Cookies | "Đăng xuất" xóa **toàn bộ** cookie domain **không có hộp thoại xác nhận** | `popup.js:4213-4247` |
| **L-18** | Medium | Robustness | Nhiều `navigator.clipboard.writeText(...)` không `.catch` ⇒ unhandled rejection | `popup.js:1971-4205` |
| **L-19** | Low | Generator | `secureRandomInt(max)` treo vô hạn khi `max > 2^32`; `max` không nguyên | `popup.js:13-21`, `background.js:156-164` |
| **L-20** | Low | Generator | Context menu dùng pool khác popup, không đảm bảo đủ lớp ký tự, không lọc ambiguous | `background.js:167-173,445-449` |
| **L-21** | Low | Passphrase | Entropy bỏ qua vị trí chữ số; dùng số từ chưa clamp; fallback wordlist lệch kích thước | `popup.js:173-209,2437-2441` |
| **L-22** | Low | History | `id = Date.now().toString()` trùng khi tạo trong cùng 1 ms ⇒ xóa nhầm nhiều mục | `popup.js:1776`, `content.js:294` |
| **L-23** | Low | History | Timestamp là chuỗi locale không sắp xếp được; `length` lưu dư; xóa lịch sử không hỏi xác nhận | `popup.js:1784,3253-3262` |
| **L-24** | Low | TOTP | Dedup 2FA bất đối xứng: popup không dedup, background dedup theo secret và ghi đè tên | `popup.js:3145-3192`, `background.js:404-439` |
| **L-25** | Low | TOTP | `render2FA` giả định `item.name` tồn tại ⇒ 1 mục hỏng làm vỡ toàn bộ render (unhandled) | `popup.js:2077-2111` |
| **L-26** | Low | TOTP | `otpauth://hotp` bị popup từ chối nhưng background nhận như TOTP; host check phân biệt hoa/thường | `popup.js:740`, `background.js:237-260` |
| **L-27** | Low | Vault | Đổi PIN không xác minh PIN cũ; không shred ciphertext cũ; `vaultEnable` đọc mảng in-memory | `popup.js:1420-1489` |
| **L-28** | Low | Vault | Heartbeat 20s làm "timeout không dùng" không bao giờ kích hoạt khi popup đang mở | `popup.js:1300-1308` |
| **L-29** | Low | Vault | Catch của `vaultUnlock` bắt cả lỗi render sau khi mở khóa thành công ⇒ báo "PIN sai" + tăng bộ đếm | `popup.js:1391-1417` |
| **L-30** | Low | Cards | `validateExpiryDate` nhận thẻ hết hạn; format/validate không đối xứng | `popup.js:76-91` |
| **L-31** | Low | Cards | `maskCardNumber` popup che toàn bộ số, `content.js` lộ 4 số cuối; README nói lộ 1234 | `popup.js:70-74`, `content.js:357-363` |
| **L-32** | Low | Cards | Không kiểm tra CVV/hạn; không chống trùng khi thêm tay; "Sao chép tất cả" đưa cả PAN+CVV vào clipboard | `popup.js:3642-3716,3454-3475` |
| **L-33** | Low | Cookies | `applyCookieProfile` không xóa cookie cũ của domain đích ⇒ "chuyển tài khoản" không thật sự sạch phiên | `popup.js:3997-4030` |
| **L-34** | Low | Cookies | Cookie hết hạn được truyền thẳng; lỗi bị nuốt; toast luôn báo thành công theo `cookies.length` | `popup.js:3738-3760,4213-4247` |
| **L-35** | Low | Autofill | Heuristic OTP quá rộng (`auth` khớp "author", `mã` khớp "mã giảm giá", `maxLength 6/8`) | `content.js:781-812` |
| **L-36** | Low | Robustness | Nuốt lỗi rộng (`catch {}`), `gpSet` của content script bỏ qua `res.ok === false` | `content.js:69-79`, `popup.js:731-733` |
| **L-37** | Low | Robustness | Lạm dụng `parseInt(...) || 0` / `Number()` không nhất quán; `compareVersions` cắt hậu tố | `popup.js:1208-1218,2565-2576` |
| **L-38** | Info | Dead code | Handler `vault_lock`/`vault_state` không nơi nào gửi; `validateLuhn` popup không dùng | `background.js:744-755`, `popup.js:47` |
| **L-39** | Info | Trùng lặp mã | 7 hàm bị sao chép ở 2-3 file với khác biệt tinh tế (nguồn của L-20/L-26/L-31) | nhiều file |
| **L-40** | Info | Migration | Khi bật vault: mã hóa + ghi đè rác + xóa plaintext **đã làm đúng** (điểm tốt, ghi lại để đối chiếu) | `popup.js:1420-1455` |
| **L-12b** | Low | History | Mọi lần bấm "Sao chép" đều tự động lưu vào lịch sử (không opt-in); mật khẩu có thể tồn tại ở nhiều kho | `popup.js:2542-2549` |
| **L-12c** | Medium | Vault/Privacy | Bật xem mật khẩu ở ô generator sẽ tắt che mật khẩu trong Lịch sử ở lần mở sau | `popup.js:1215,1637-1639,2967-2971` |
| **L-37b** | Low | Generator | `length` không hợp lệ (NaN) ⇒ trả về mật khẩu chỉ gồm ký tự bắt buộc | `popup.js:1200,140-150` |

---

## 1. Sinh mật khẩu (popup.js + background.js)

### L-01 · High · Generator — Bỏ rơi lớp ký tự khi số ký tự bắt buộc vượt `length`

**Vị trí:** `popup.js:139-152`

**Bằng chứng (trích nguyên văn):**

```js
const fullPool = activePools.join("");
const targetLength = Math.max(length, requiredChars.length);   // 140
const result = [...requiredChars];                             // 141

while (result.length < targetLength) {                         // 143
  result.push(fullPool[secureRandomInt(fullPool.length)]);     // 144
}

// Trim if required exceeds desired length
if (result.length > length) {                                  // 148
  result.length = length;                                      // 149
}

return secureShuffle(result).join("");                          // 152
```

`requiredChars` được dựng theo **thứ tự cố định** `[upper, lower, numbers…, special…]` (`popup.js:111-132`):

```js
if (upper && upperPool.length > 0)   { requiredChars.push(upperPool[secureRandomInt(upperPool.length)]); }   // 111-114
if (lower && lowerPool.length > 0)   { requiredChars.push(lowerPool[secureRandomInt(lowerPool.length)]); }   // 115-118
if (numbers && numbersPool.length > 0) { const count = Math.max(1, minNumbers || 0); ... }                   // 119-125
if (special && specialPool.length > 0) { const count = Math.max(1, minSpecial || 0); ... }                   // 126-132
```

**Tác động (đã chứng minh bằng harness Node trích nguyên văn hàm):** khi `length < requiredChars.length`, dòng 149 cắt mảng từ **cuối**, tức là cắt bỏ **lớp `special` trước**, rồi tới `numbers`, `lower`:

```
=== TEST A: length=4, all classes, minNum=2 minSpecial=2 ===
88Kh | hasSpecial= false | digits= 2
kY68 | hasSpecial= false | digits= 2
Hl09 | hasSpecial= false | digits= 2
1jP9 | hasSpecial= false | digits= 2
7pM6 | hasSpecial= false | digits= 2
```

Người dùng **bật** ký tự đặc biệt và đặt "tối thiểu 2 ký tự đặc biệt" nhưng mật khẩu **không hề có ký tự đặc biệt**, không cảnh báo. Vi phạm trực tiếp cam kết "Đảm bảo mỗi lớp ký tự được chọn đều xuất hiện"; có thể khiến mật khẩu bị website từ chối (yêu cầu có ký tự đặc biệt) hoặc bị người dùng tin nhầm là mạnh hơn thực tế.

**Cách sửa:** không cắt mảng; thay vào đó **giảm số lớp bắt buộc** cho khớp `length` và **thông báo rõ** lớp nào bị bỏ, hoặc chặn không cho `length` nhỏ hơn số lớp yêu cầu; tuyệt đối không để `minSpecial`/`minNumbers` lớn hơn `length`.

---

### L-07 · Medium · Generator — `minNumbers`/`minSpecial` vượt `length` bị bỏ qua âm thầm; `min` thực tế luôn ≥ 1

**Vị trí:** `popup.js:119-132`; HTML `popup.html:184-189` (`min-numbers`/`min-special` cho phép `min=0 max=10`)

**Bằng chứng:**

```js
const count = Math.max(1, minNumbers || 0);   // 121 — không thể bằng 0
for (let i = 0; i < count; i++) { requiredChars.push(...); }   // 122-124
```

**Tác động (harness):**

```
=== TEST C: minNumbers=10 with length=5 ===
Qu753 digits= 3
a680A digits= 3
l4Q93 digits= 3
```

Hai hệ quả: (a) đặt `min = 0` vẫn luôn bị ép **1** ký tự số/ký tự đặc biệt — tùy chọn "tối thiểu" không trung thực với nhãn UI; (b) đặt `min = 10` với `length = 5` cho ra 3 số và **không báo gì**.

**Cách sửa:** clamp `minNumbers`/`minSpecial` theo `length` (`min(n, length - số ký tự các lớp khác)`) và phản hồi khi bị clamp; hoặc cho phép 0 thật sự nếu UI ghi "tối thiểu 0".

---


### L-19 · Low · Generator — `secureRandomInt(max)` treo vô hạn khi `max > 2^32`

**Vị trí:** `popup.js:13-21` (bản sao: `background.js:156-164`)

**Bằng chứng:**

```js
function secureRandomInt(max) {
  if (max <= 0) return 0;
  const limit = Math.floor(0x100000000 / max) * max;   // 15
  const buf = new Uint32Array(1);
  do { crypto.getRandomValues(buf); } while (buf[0] >= limit);   // 17-19
  return buf[0] % max;
}
```

**Tác động (toán học xác nhận bằng Node):**

```
max=4294967296   limit= 4294967296   (ok)
max=4294967297   limit= 0            << INFINITE LOOP (limit=0, Uint32 luôn >= 0)
max=8589934592   limit= 0            << INFINITE LOOP
```

Với `max > 2^32`, `Math.floor(0x100000000/max) = 0` ⇒ `limit = 0` ⇒ vòng `do/while` **không bao giờ thoát**, treo cứng popup/service worker (không hủy được). Hiện mọi caller truyền giá trị nhỏ (≤ 1296) nên **chưa kích hoạt được**, nhưng đây là primitive "secure random" mà bất kỳ dòng mã mới nào cũng có thể gọi sai. Ngoài ra `max` không nguyên (ví dụ `secureRandomInt(2.5)`) cho phân bố sai.

**Cách sửa:** thêm guard `if (!Number.isInteger(max) || max <= 0) throw new RangeError(...)`; nếu `max > 0x100000000` thì ghép nhiều lần `getRandomValues` (hoặc dùng `BigInt` với rejection sampling trên 2^53).

---

### L-20 · Low · Generator — Bộ sinh ở context menu lệch hoàn toàn so với popup

**Vị trí:** `background.js:167-173`, `background.js:445-449`

**Bằng chứng:**

```js
function generatePasswordFromPool(len, chars) {          // 167
  let pwd = "";
  for (let i = 0; i < len; i++) pwd += chars[secureRandomInt(chars.length)];
  return pwd;                                            // 172 — không đảm bảo lớp nào
}
...
const POOLS = {
  std: "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*()-_=+",   // 446
  alphanum: "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789",            // 447
  pin: "0123456789"                                                                 // 448
};
```

**Tác động:** "Mật khẩu chuẩn (16 ký tự)" từ menu chuột phải chỉ lấy mẫu **đều trên toàn pool** nên có xác suất ~`(60/89)^16 ≈ 0.4%` không chứa ký tự đặc biệt, ~0.0003% không chứa chữ số — không như popup vốn ép mỗi lớp xuất hiện. Tập ký tự đặc biệt cũng khác popup (`CHAR_SETS.special` = `!@#$%^&*()-_=+[]{}|;:,.<>?/`). Hai nơi sinh "cùng loại mật khẩu" nhưng theo quy tắc khác nhau.

**Cách sửa:** dùng chung một module sinh (ví dụ `generatePassword()` của popup) cho cả background; hoặc ít nhất thêm bước "đảm bảo đủ lớp" cho `generatePasswordFromPool`.

---


### L-21 · Low · Passphrase — Đếm entropy lệch và fallback wordlist lệch kích thước

**Vị trí:** `popup.js:173-209`, `popup.js:2437-2441`

**Bằng chứng:**

```js
if (includeNumber) {
  const randomDigit = secureRandomInt(10).toString();   // 192
  const randPos = secureRandomInt(words.length);        // 193 — thêm log2(count) bit không được tính
  words[randPos] += randomDigit;                        // 194
}
...
function calculatePassphraseStrength(numWords, includeNumber, wordlistSize = 1296) {
  const bitsPerWord = Math.log2(wordlistSize || 1296);  // 201
  let entropy = numWords * bitsPerWord;
  if (includeNumber) entropy += 3.32;                   // 203
```

**Tác động:** (a) vị trí chèn chữ số (`randPos`) đóng góp thêm `log2(numWords)` bit nhưng không được tính ⇒ entropy bị **đếm thiếu**; (b) `calculatePassphraseStrength` nhận `opts.passphraseWords` (giá trị thô) trong khi `generatePassphrase` clamp `Math.max(3, Math.min(10, numWords))` (`popup.js:178`) ⇒ nếu giá trị trong storage vượt khoảng, số bit báo cáo lệch với số từ thật; (c) nếu `DICEWARE_WORDS` không nạp được, `generatePassphrase` rơi vào fallback **4 từ** (`popup.js:173-175`) nhưng độ mạnh vẫn tính với `wordlistSize = 1296` ⇒ báo mạnh giả. Wordlist thực tế đã kiểm tra: **1296 từ, 0 trùng lặp** (khớp claim EFF).

**Cách sửa:** dùng cùng một giá trị `count` đã clamp cho cả sinh và tính entropy; cộng `Math.log2(count)` khi có chèn số; kiểm tra `wordlistSize` khớp wordlist thực tế.

---

### L-06 · Medium · Entropy — `getActivePoolSize` bỏ qua `avoidAmbiguous` và bỏ qua lớp bị cắt

**Vị trí:** `popup.js:1188-1195` (dùng ở `popup.js:2463-2468`)

**Bằng chứng:**

```js
function getActivePoolSize(opts) {                 // 1188
  let size = 0;
  if (opts.upper) size += CHAR_SETS.upper.length;  // 1190 — pool GỐC, chưa lọc ambiguous
  if (opts.lower) size += CHAR_SETS.lower.length;
  if (opts.numbers) size += CHAR_SETS.numbers.length;
  if (opts.special) size += CHAR_SETS.special.length;
  return Math.max(size, 1);
}
...
const poolSize = getActivePoolSize(opts);            // 2463
const strength = calculateStrength(pass, poolSize);  // 2464
```

**Tác động (harness):**

```
=== TEST B: avoidAmbiguous entropy overstatement ===
reported poolSize = 89
actual filtered pool = 81
reported entropy 16 = 103.1   actual = 101.4
```

Với `avoidAmbiguous` bật, entropy **báo cao hơn** ~1.7 bit cho 16 ký tự. Quan trọng hơn, khi L-01 xảy ra (lớp bị cắt), `poolSize` vẫn cộng ký tự đặc biệt dù mật khẩu **không chứa** ký tự đặc biệt ⇒ chỉ số "Độ mạnh" có thể **nói dối**: nó đo *tùy chọn người dùng đã tick*, không đo *mật khẩu thực sinh ra*. Cũng cần nêu rõ: dự án **không** dùng zxcvbn hay mô hình dò mẫu nào — chỉ có công thức `length * log2(poolSize)` (`popup.js:157`) với 4 ngưỡng cứng 40/60/80 bit (`popup.js:159-162`), nên nó không phát hiện được các mẫu yếu (từ điển, lặp ký tự).

**Cách sửa:** tính `poolSize` từ chính pool đã lọc (`filterAmbiguous`) và từ đúng các lớp thực sự được dùng để sinh; hoặc (tốt hơn) tính entropy từ mật khẩu thực tế + kiểm tra sự hiện diện của từng lớp.

---

### L-37b · Low · Generator — Đường biên `length` không hợp lệ trả về mật khẩu "chỉ gồm ký tự bắt buộc"

**Vị trí:** `popup.js:1200` (`parseInt(els.lengthRange.value, 10)`) → `popup.js:140,148`

Nếu `els.lengthRange.value` rỗng/không phải số, `length = NaN` ⇒ `targetLength = Math.max(NaN, reqLen) = NaN` ⇒ vòng `while (result.length < NaN)` không chạy và `if (result.length > NaN)` cũng sai ⇒ hàm trả về **đúng `requiredChars`** (ví dụ 4 ký tự) bất kể thanh trượt. Trong thực tế `<input type="range">` luôn có giá trị hợp lệ nên đây là lỗi phòng thủ (defensive). **Sửa:** validate `Number.isInteger(length) && length >= 1` trước khi sinh.

---

### Điểm tốt (phần sinh mật khẩu)

- `secureRandomInt` dùng **rejection sampling đúng** cho `max ≤ 2^32`: `limit = floor(2^32/max)*max` rồi loại `buf[0] >= limit` ⇒ **không có modulus bias** cho các caller hiện tại (`popup.js:15-20`).
- Xáo trộn bằng **Fisher–Yates với CSPRNG** (`secureShuffle`, `popup.js:24-30`) chứ không dùng `sort(() => Math.random()-0.5)`.
- Bộ lọc ký tự dễ nhầm (`filterAmbiguous`, `popup.js:32-34`) hoạt động đúng trên cả 4 pool.
- Wordlist Diceware đúng **1296 từ, không trùng lặp** (đã đếm bằng script), chọn từ bằng `secureRandomInt` (không bias).
- Có fallback khi người dùng tắt hết lớp ký tự (`popup.js:135-137` và `popup.js:2455-2458`) ⇒ không sinh chuỗi rỗng.

---


## 2. Lịch sử (history)

### L-02 · High · History — `saveHistoryItem` gộp nhầm metadata hai site khác nhau khi trùng mật khẩu

**Vị trí:** `popup.js:1743-1773`

**Bằng chứng:**

```js
if (currentHistory.length > 0 && currentHistory[0].password === password) {   // 1743
  let modified = false;
  if (trimmedName && currentHistory[0].name !== trimmedName) { currentHistory[0].name = trimmedName; modified = true; }        // 1745-1748
  if (cleanUser && currentHistory[0].username !== cleanUser) { currentHistory[0].username = cleanUser; modified = true; }      // 1749-1752
  if (cleanTag && currentHistory[0].tag !== cleanTag)        { currentHistory[0].tag = cleanTag; modified = true; }            // 1753-1756
  if (cleanUrl && currentHistory[0].url !== cleanUrl)        { currentHistory[0].url = cleanUrl; modified = true; }            // 1757-1760
  if (cleanNote && currentHistory[0].note !== cleanNote)     { currentHistory[0].note = cleanNote; modified = true; }          // 1761-1764
  ...
  return; // Skip duplicate consecutive saves                                     // 1772
}
```

**Tác động (đã chứng minh bằng harness trích nguyên văn hàm):**

```
history length = 1 (kỳ vọng 2 nếu dedup đúng theo site)
[{ "name": "Google", "url": "https://google.com", "user": "bob@gmail.com" }]

-- chứng minh gộp nhầm: mục Facebook đã bị đổi thành Google --
currentHistory[0].name = Google  url = https://google.com  user = bob@gmail.com
```

Lưu `P@ssw0rd1` cho Facebook rồi lưu **cùng mật khẩu** cho Google ⇒ mục Facebook **biến mất** (bị ghi đè thành Google), mất tài khoản/URL/ghi chú cũ. Vì "Sao chép" tự động lưu (`popup.js:2542-2549`), người dùng rất dễ trúng tình huống này.

**Cách sửa:** dedup phải so theo **(tên miền + tài khoản)** chứ không phải chỉ mật khẩu; nếu trùng mật khẩu nhưng khác domain thì **tạo mục mới** thay vì sửa mục cũ; nếu muốn cập nhật thì phải chỉ cập nhật khi cùng domain.

---

### L-12 · Medium · History — Dedup chỉ so với mục đầu; dedup theo mật khẩu gộp hai tài khoản khác nhau

**Vị trí:** `popup.js:1743-1746`

Dòng 1743 chỉ kiểm tra `currentHistory[0]` (mục mới nhất). Nếu người dùng sinh lại **cùng mật khẩu** sau khi đã có mục khác ở giữa, một bản ghi trùng mới được `unshift` ⇒ lịch sử phình và có nhiều mục trùng. Đồng thời tiêu chí dedup là *mật khẩu* nên hai tài khoản khác nhau dùng chung mật khẩu bị coi là một (xem L-02).

**Cách sửa:** dedup theo khóa `(domain, username, password)`; quét toàn bộ mảng thay vì chỉ phần tử [0]; hoặc chỉ chống trùng trong cửa sổ thời gian ngắn (ví dụ 10 giây) như cơ chế `lastSubmittedCredentials` đang làm ở content script (`content.js:215-218`).

---

### L-22 · Low · History — `id = Date.now().toString()` trùng khi tạo trong cùng 1 ms

**Vị trí:** `popup.js:1776`, `content.js:294`, `popup.js:3175`, `popup.js:3703`, `popup.js:4088`

```js
const item = { id: Date.now().toString(), ... };   // popup.js:1776
```

Xóa/sửa được thực hiện bằng `filter(h => h.id !== item.id)` (`popup.js:2033`) — nếu hai mục có cùng `id`, **một thao tác xóa sẽ xóa cả hai**. Lưu ý `handleCsvImport` đã xử lý đúng bằng `(Date.now() + i).toString()` (`popup.js:2385`), nhưng `saveHistoryItem`/2FA/thẻ/cookie thì không.

**Cách sửa:** dùng `crypto.randomUUID()` (có sẵn trong extension page) làm `id`.

---

### L-23 · Low · History — Timestamp không sắp xếp được, `length` lưu dư, xóa lịch sử không hỏi xác nhận

**Vị trí:** `popup.js:1784`, `popup.js:3253-3262`

```js
createdAt: new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) + " " + new Date().toLocaleDateString("vi-VN")   // 1784
```

- `createdAt` là **chuỗi locale** (phụ thuộc timezone/múi giờ và locale máy) ⇒ không sắp xếp/so sánh được, không parse lại được. Lịch sử hiển thị theo **thứ tự chèn** (`unshift`) chứ không theo thời gian, nên khi import CSV (chèn hàng loạt) thứ tự hiển thị là thứ tự file, không phải thời gian.
- `length: password.length` (`popup.js:1783`) là dữ liệu dư thừa, có thể lệch nếu mật khẩu bị sửa.
- `btnClearHistory` (`popup.js:3253-3262`) xóa **toàn bộ** lịch sử **không có hộp thoại xác nhận**; cũng không reset `activeFilterTag`.

**Cách sửa:** lưu `createdAt: Date.now()` (số) và format khi render; thêm confirm cho thao tác xóa; reset `activeFilterTag` sau khi xóa.

---

### L-12b · Low · History — Mật khẩu lưu lặp ở nhiều nơi và lưu ngay khi chỉ bấm "Sao chép"

**Vị trí:** `popup.js:2542-2549` (copy ⇒ `saveHistoryItem`), `popup.js:1775-1785`, `content.js:293-305`

`navigator.clipboard.writeText(els.display.value).then(() => { saveHistoryItem(...) })` — **mọi lần sao chép** đều tự động lưu vào lịch sử dù người dùng không có ý định lưu; cùng một mật khẩu có thể tồn tại đồng thời ở `genHistory` (mật khẩu) và `genCards`/`gen2FA` (nếu người dùng dán vào ghi chú), làm tăng bề mặt rò rỉ at-rest. Đây là lựa chọn thiết kế (README quảng bá "tự động ghi nhớ vào mục Lịch sử"), nhưng cần ghi nhận là **không opt-in**.

**Cách sửa:** chỉ tự lưu khi người dùng bật tùy chọn; hoặc thêm cờ "chỉ lưu khi đặt tên".

---

### Điểm tốt (phần lịch sử)

- Giới hạn **200 mục** được áp dụng nhất quán ở cả 3 đường ghi (`popup.js:1788`, `popup.js:2400-2402`, `content.js:305`).
- Import CSV dedup theo tập mật khẩu đã có (`popup.js:2343-2358`) và escape CSV đúng chuẩn (nhân đôi dấu `"`, bọc ô chứa dấu phẩy/xuống dòng — `popup.js:2204-2211`).
- `parseCsv` xử lý đúng BOM, dấu `\r\n`, ô có dấu phẩy trong ngoặc kép (`popup.js:2261-2315`).
- Lịch sử mặc định che mật khẩu thành `•••` (`popup.js:1981-1983`).

---


## 3. TOTP / 2FA

### L-03 · High · TOTP — Bỏ qua `digits`/`period`/`algorithm` của `otpauth://` ⇒ mã luôn sai với tài khoản 8 số / 60s / SHA-256

**Vị trí:** `popup.js:736-762` + `popup.js:701-734`; `background.js:237-260` + `background.js:210-233`

**Bằng chứng:** `parseOtpAuthUrl` **chỉ** đọc `issuer`, `secret` và phần label — không hề đọc `digits`, `period`, `algorithm`:

```js
const secret = url.searchParams.get("secret") || "";       // popup.js:753
return { name: issuer || account || "2FA", account: account, secret: secret.trim() };   // 754-758
```

Và hàm tính mã **hard-code** SHA-1 / 6 số / 30 giây:

```js
const counter = Math.floor(timeSec / 30);   // popup.js:706  (background.js:213)
{ name: "HMAC", hash: "SHA-1" }             // popup.js:714  (background.js:221)
const otp = binary % 1000000;               // popup.js:729  (background.js:233)
return otp.toString().padStart(6, "0");     // popup.js:730
```

**Tác động (harness):** mọi tham số khác đều bị nuốt im lặng:

```
URL: otpauth://totp/GitHub:alice?secret=JBSWY3DPEHPK3PXP&digits=8
  popup: {"name":"GitHub","account":"alice","secret":"JBSWY3DPEHPK3PXP"}
URL: otpauth://totp/GitHub:alice?secret=JBSWY3DPEHPK3PXP&period=60
  popup: {"name":"GitHub","account":"alice","secret":"JBSWY3DPEHPK3PXP"}
URL: otpauth://totp/GitHub:alice?secret=JBSWY3DPEHPK3PXP&algorithm=SHA256
  popup: {"name":"GitHub","account":"alice","secret":"JBSWY3DPEHPK3PXP"}
popup totp returns only 6 digits always: 6
```

Với tài khoản yêu cầu **8 chữ số** (một số ngân hàng/dịch vụ), **chu kỳ 60s**, hoặc **SHA-256/SHA-512**, GenPass hiển thị một mã **6 số luôn sai** mà không có cảnh báo nào. Đây là sai lệch giữa claim "chuẩn RFC 6238" và thực tế (RFC 6238 cho phép SHA-256/SHA-512 và độ dài mã khác).

**Cách sửa:** lưu `digits`/`period`/`algorithm` vào item 2FA (kể cả trong blob vault), validate whitelist (`digits ∈ {6,8}`, `period ∈ {15,30,60}`, `algorithm ∈ {SHA1,SHA256,SHA512}`), và **cảnh báo/từ chối** khi gặp giá trị chưa hỗ trợ thay vì tính sai im lặng.

---

### L-13 · Medium · TOTP — `base32Decode` bỏ qua ký tự sai âm thầm; validate quá yếu

**Vị trí:** `popup.js:678-699` (bản sao `background.js:188-207`), validate ở `popup.js:3166-3170`

**Bằng chứng:**

```js
const clean = str.replace(/=+$/, "").toUpperCase().replace(/\s+/g, "");   // popup.js:680
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
for (let i = 0; i < clean.length; i++) {
  const val = alphabet.indexOf(clean[i]);
  if (val === -1) continue;        // 688 — ký tự sai bị BỎ QUA, không báo lỗi
```

```js
const decoded = base32Decode(secret);
if (decoded.length === 0) { showToast("Khóa bí mật Base32 không hợp lệ!"); return; }   // 3167-3170
```

**Tác động (harness):**

```
=== INVALID CHARS silently skipped (0,1,8,9) ===
secret with 0 inserted "GEZD0GNBV...": decoded bytes = 20  (giống hệt secret sạch)
code with 0 = 287082   (không có lỗi nào được ném ra)
```

Vì bỏ qua ký tự **không làm lệch bit-alignment** (không cộng 5 bit khi skip), một secret gõ nhầm `0/1/8/9` (không thuộc Base32) sẽ được **chấp nhận** và sinh mã **sai vĩnh viễn**. Ngược lại chuỗi toàn ký tự sai (`"0000000000"`) bị từ chối, nhưng `"00000000ABC"` (còn vài ký tự hợp lệ) lại **được nhận**.

**Cách sửa:** throw khi gặp ký tự ngoài bảng chữ Base32; kiểm tra độ dài secret tối thiểu (thường ≥ 16 ký tự ~ 80 bit) và thông báo rõ ký tự sai.

---


### L-24 · Low · TOTP — Dedup 2FA bất đối xứng giữa popup và background

**Vị trí:** `popup.js:3145-3192` (thêm tay), `background.js:404-439` (lưu từ QR / context menu)

```js
// background.js — dedup theo SECRET, ghi đè cả name/account
const existingIndex = list.findIndex(item => item.secret && item.secret.toUpperCase() === cleanSecret);   // 416
const newItem = { id: existingIndex >= 0 ? list[existingIndex].id : Date.now().toString(),
                  name: name || (existingIndex >= 0 ? list[existingIndex].name : "2FA Account"), ... };   // 418-424
```

```js
// popup.js — KHÔNG dedup: unshift thẳng
current2FA.unshift(newItem);   // 3182
```

**Tác động:** quét cùng một QR hai lần ⇒ **2 mục trùng** ở popup nhưng **1 mục** ở luồng background; ngược lại, quét QR của secret đã có với issuer khác sẽ **ghi đè tên** mục cũ. Dedup không nhất quán gây nhầm lẫn và mất dữ liệu nhẹ.

**Cách sửa:** thống nhất một hàm `upsert2FA(secret, name, account)` dùng chung, dedup theo `secret`, chỉ cập nhật tên khi tên mới không rỗng.

---

### L-25 · Low · TOTP — `render2FA` giả định `item.name` tồn tại

**Vị trí:** `popup.js:2077-2083`, `popup.js:2111`

```js
const sorted = [...current2FA].sort((a, b) => {
  const matchA = currentDomain && (a.name.toLowerCase().includes(currentDomain) || ...);   // 2078
```

Nếu một mục trong kho (dữ liệu cũ / nhập tay / sửa storage) thiếu `name`, `.toLowerCase()` ném `TypeError`. Vì `render2FA` là hàm `async` và được gọi từ `start2FaTicker` (setInterval, `popup.js:2197-2201`) cùng `vaultView` mà **không await/catch**, lỗi trở thành **unhandled promise rejection** và danh sách 2FA **dừng render giữa chừng**.

**Cách sửa:** dùng `(a.name || "").toLowerCase()`; bọc `render2FA` bằng try/catch; bọc các lời gọi trong ticker bằng `.catch()`.

---

### L-26 · Low · TOTP — `otpauth://hotp` bị popup từ chối nhưng background nhận như TOTP; host check phân biệt hoa/thường

**Vị trí:** `popup.js:740`, `background.js:237-260`

```js
// popup.js
if (url.protocol !== "otpauth:" || url.host !== "totp") return null;    // 740 — chặn hotp, chặn "TOTP" hoa
// background.js
if (url.protocol !== "otpauth:") return null;                          // 240 — KHÔNG kiểm host
```

**Tác động (harness):**

```
URL: otpauth://hotp/GitHub:alice?secret=JBSWY3DPEHPK3PXP&counter=5
  popup: null
  bg   : {"name":"GitHub","account":"alice","secret":"JBSWY3DPEHPK3PXP"}     <-- nhận nhầm HOTP thành TOTP
URL: otpauth://TOTP/GitHub:alice?secret=JBSWY3DPEHPK3PXP
  popup: null                                                                 <-- chặn oan
```

Một QR **HOTP** (có `counter`) bị background lưu và tính như TOTP ⇒ mã sai. Ngược lại `otpauth://TOTP/...` (viết hoa) bị popup chặn oan dù hợp lệ.

**Cách sửa:** kiểm tra `url.host.toLowerCase() === "totp"` và **từ chối tường minh** `hotp` kèm thông báo "chưa hỗ trợ HOTP"; thống nhất logic parse giữa hai file.

---

### Điểm tốt (phần TOTP)

- Thuật toán TOTP **đúng chuẩn**: đã kiểm tra bằng vector RFC 6238 (`GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ`, `t=59`) → `287082` ✔ (cả bản popup và background cho cùng kết quả).
- **Chuẩn hóa đầu vào tốt**: chấp nhận chữ thường, khoảng trắng, padding `=`; đã kiểm tra `lowercase`/`spaces`/`=+` đều cho `287082`.
- Công thức counter `Math.floor(Date.now()/1000/30)` tương đương `Math.floor(now/30000)` — không off-by-one ở ranh giới cửa sổ (đã kiểm chứng bằng đại số).
- Dynamic truncation theo RFC 4226 (`offset = last & 0x0f`, mask `0x7f`) đúng.
- OTP chỉ được điền ở **top frame** (`content.js:769-772`) ⇒ iframe khác origin không đọc được mã.
- Hiển thị mã chia nhóm 3-3 và thanh đếm thời gian đổi màu theo ngưỡng 5s/10s (`popup.js:2122,2143`).
- Có xử lý `keyBytes.length === 0` ⇒ không gọi HMAC với khóa rỗng (`popup.js:703`).

---


## 4. Vòng đời PIN kho mã hóa (vault)

### L-04 · High · Vault PIN — Lockout chỉ trong RAM popup; bypass bằng cách đóng/mở lại popup

**Vị trí:** `popup.js:427-428` (khai báo), `popup.js:1373-1417` (dùng)

**Bằng chứng:**

```js
let currentLang = "vi";
let vaultFailedAttempts = 0;    // 427 — biến trong scope DOMContentLoaded của popup
let vaultLockoutUntil = 0;      // 428
```

```js
} catch (err) {
  console.warn("Mo kho that bai:", err);
  vaultFailedAttempts++;                              // 1404
  if (vaultFailedAttempts >= 5) {                     // 1405
    vaultLockoutUntil = Date.now() + 15000;           // 1406 — chỉ 15 giây
  }
  vaultShowError(els.vaultLockError, errMsg);         // 1409
```

**Tác động:** hai biến này **không được lưu ở đâu cả** (không `chrome.storage`, không session, không gửi background). Mỗi lần popup bị đóng và mở lại, script popup được nạp mới ⇒ `vaultFailedAttempts = 0`, `vaultLockoutUntil = 0`. Do đó:

- **Bypass 1 (đóng/mở popup):** công cụ tự động chỉ cần đóng popup sau mỗi 4 lần thử ⇒ **không bao giờ bị lockout**.
- **Bypass 2 (offline):** blob `genVault` nằm trong `chrome.storage.local` (LevelDB trên đĩa). Kẻ tấn công đọc file **hoàn toàn không đi qua UI**, nên mọi rate-limit phía popup **vô nghĩa** với mô hình đe dọa at-rest.
- **Không có rate-limit ở background:** `background.js` chỉ có `vault_get`/`vault_put` (`background.js:757-771`), **không có** message `vault_unlock` nào — không thể brute-force trực tiếp qua background, nhưng cũng đồng nghĩa lockout không tồn tại ở tầng thấp hơn.

**Kiểm chứng claim:** `tests/security-i18n.test.cjs:61-63` chỉ **grep chuỗi** để xác nhận biến tồn tại:

```js
// 4. Rate limiting logic check
assert(popupContent.includes("vaultLockoutUntil"), "vaultLockoutUntil rate-limit variable must exist");
assert(popupContent.includes("vaultFailedAttempts"), "vaultFailedAttempts counter must exist");
console.log("✓ Vault PIN rate-limiting logic present");
```

⇒ Test **pass dù tính năng hỏng**; README (`README.md:187`) "Cơ chế giới hạn tần suất nhập mã PIN ngăn chặn các công cụ tự động thử hàng nghìn mã mỗi giây" là **quá mức so với thực tế**.

**Cách sửa:** lưu `{count, lockoutUntil}` vào `chrome.storage.local` (không nhạy cảm) và **đếm ở background** trước khi trả key; thêm backoff theo cấp số nhân (15s → 1m → 5m → 30m); ghi rõ trong tài liệu rằng rate-limit **không** bảo vệ trước brute-force offline.

---


### L-27 · Low · Vault — Đổi PIN không xác minh PIN cũ; không shred ciphertext cũ; `vaultEnable` đọc mảng in-memory

**Vị trí:** `popup.js:1481-1489`, `popup.js:1432-1456`, `popup.js:1458-1479`

```js
async function vaultChangePin(secret) {
  const blob = await GPVault.encryptWithPin(vaultData, secret);      // 1482 — KHÔNG kiểm tra PIN cũ
  const keyB64 = (await GPVault.unlockWithPin(blob, secret)).keyB64; // 1483
  await chrome.storage.local.set({ genVault: blob });               // 1484 — ghi đè, không shred blob cũ
```

```js
async function vaultEnable(secret) {
  const payload = { genHistory: currentHistory, gen2FA: current2FA, ... };   // 1433-1439 — đọc biến in-memory
```

**Tác động:** (a) đổi PIN chỉ cần kho đang mở — nếu người dùng quên khóa máy, kẻ khác có thể **đổi PIN vĩnh viễn** mà không cần biết PIN cũ; (b) blob cũ (mã hóa bằng PIN cũ) bị **ghi đè giá trị** nhưng không được ghi rác trước như `vaultShredPlaintext` (`popup.js:1420-1430`), nên có thể còn dấu vết trong LevelDB; (c) `vaultEnable` lấy dữ liệu từ mảng in-memory thay vì đọc lại storage, nên nếu context khác (background/content) vừa ghi, dữ liệu mới có thể bị **mã hóa thiếu**.

**Cách sửa:** bắt buộc nhập PIN cũ trước khi đổi; ghi rác lên `genVault` cũ trước khi ghi blob mới; `vaultEnable` đọc lại `chrome.storage.local.get(VAULT_KEYS)` ngay trước khi mã hóa.

---

### L-28 · Low · Vault — Heartbeat 20s làm "timeout không dùng" không bao giờ kích hoạt khi popup đang mở

**Vị trí:** `popup.js:1300-1308`, `popup.js:1242-1246`

```js
function vaultHeartbeatStart() {
  if (vaultHeartbeat) clearInterval(vaultHeartbeat);
  const min = vaultTimeoutMin();
  if (min <= 0) return;
  vaultHeartbeat = setInterval(() => {
    if (vaultKey) vaultSessionSet(vaultKey, min).catch(() => {});   // 1306 — gia hạn exp mỗi 20s
  }, 20000);
}
```

**Tác động:** `exp` được **đẩy về tương lai mỗi 20 giây bất kể người dùng có thao tác hay không**. Nếu người dùng ghim popup (hoặc mở `popup.html` trong tab, có hỗ trợ `?tab=`, `popup.js:4335-4347`), kho sẽ **không bao giờ tự khóa** dù không ai dùng. README (`README.md:178`) quảng bá "Tự khóa thêm sau 5, 15 hoặc 30 phút **không dùng**" — thực tế là "không dùng **và** đã đóng popup". Không có theo dõi sự kiện input/mouse để đo "idle".

**Cách sửa:** chỉ gia hạn exp khi có tương tác thật (`mousemove`/`keydown`/`click`); hoặc dùng `chrome.alarms` + `chrome.idle` (đã nằm trong roadmap README) để khóa theo idle của hệ điều hành.

---

### L-29 · Low · Vault — Catch của `vaultUnlock` bắt cả lỗi render sau khi mở khóa thành công

**Vị trí:** `popup.js:1391-1417`

```js
try {
  const { data, keyB64 } = await GPVault.unlockWithPin(vaultBlob, pin);   // 1392
  vaultFailedAttempts = 0;
  vaultFill(data, keyB64);
  await vaultSessionSet(keyB64, vaultTimeoutMin());
  vaultOn = true;
  vaultPortConnect(); vaultHeartbeatStart(); vaultSyncSettings();
  vaultRunAfterUnlock();          // 1401 — gọi vaultView() → renderTags/updateHistoryUI/... (đồng bộ)
} catch (err) {
  vaultFailedAttempts++;          // 1404 — một lỗi render cũng bị tính là "PIN sai"
  ...
  vaultShowError(els.vaultLockError, errMsg);   // 1409
```

**Tác động:** nếu một hàm render đồng bộ trong `vaultRunAfterUnlock` ném lỗi (ví dụ dữ liệu méo), kho **đã mở khóa thành công** (`vaultOn = true`, key đã lưu session) nhưng UI hiển thị "Mã PIN không đúng" và **tăng bộ đếm sai** ⇒ trải nghiệm sai lệch, có thể dẫn tới lockout oan.

**Cách sửa:** tách khối try/catch — chỉ bọc `unlockWithPin` cho phần đếm lỗi PIN; phần render đặt ngoài hoặc có catch riêng.

---

### L-11 · Medium · Vault — `genOptions.vaultEnabled` được suy ra từ checkbox UI

**Vị trí:** `popup.js:1216`, `popup.js:1223-1227`, `background.js:343`

```js
vaultEnabled: els.optVaultEnabled ? els.optVaultEnabled.checked : false,   // popup.js:1216 — trạng thái kho = trạng thái CHECKBOX
```

```js
function saveOptions(opts) { if (chrome?.storage?.local) chrome.storage.local.set({ genOptions: opts }); }   // 1223-1227
```

```js
if (!plain.genVault || !vaultReady() || plain.genOptions?.vaultEnabled !== true) return ctx;   // background.js:343
```

**Tác động:** cờ quyết định "đọc/ghi qua blob hay qua plaintext" (`background.js:343,374`) được **suy ra từ một checkbox DOM**, không phải từ sự tồn tại của blob. Bất kỳ đường gọi `saveOptions(getOptions())` nào trong lúc checkbox lệch trạng thái thật sẽ **lật chế độ**: background chuyển sang đọc/ghi plaintext (`vaultMutate` rơi vào nhánh `chrome.storage.local.set(partial)`, `background.js:374-376`), UI hiển thị kho **rỗng** dù blob vẫn còn; dữ liệu ghi mới rơi vào plaintext ⇒ **phá vỡ tính chất at-rest**.

**Cách sửa:** nguồn chân lý phải là **sự tồn tại + tính hợp lệ của blob `genVault`** (ví dụ `vaultMode = !!genVault`), không dùng cờ UI; hoặc lưu cờ trong blob đã mã hóa.

---

### L-12c · Medium · Vault/Privacy — Hiện mật khẩu ở ô generator sẽ tắt luôn che mật khẩu trong lịch sử

**Vị trí:** `popup.js:1215`, `popup.js:1637-1638`, `popup.js:2967-2971`

```js
maskPassword: els.display ? els.display.type === "password" : true,   // 1215 — suy ra từ kiểu input ô kết quả
...
maskHistoryPass = o.maskPassword !== false;                            // 1637
isMasked = maskHistoryPass;
if (els.display) els.display.type = maskHistoryPass ? "password" : "text";   // 1639
```

`handleGenerate` gọi `saveOptions(opts)` ở **mỗi lần sinh** (`popup.js:2447,2470`). Nếu người dùng bấm icon mắt để xem mật khẩu đang sinh (`isMasked = false`, `els.display.type = "text"` — `popup.js:2967-2971`), lần sinh kế tiếp sẽ lưu `maskPassword: false` ⇒ **lần sau mở popup, toàn bộ mật khẩu trong Lịch sử hiển thị dạng chữ rõ** (`popup.js:1981-1983`). Hai khái niệm "che ô kết quả" và "che lịch sử" bị trộn vào một cờ.

**Cách sửa:** tách hai cờ (`hideGeneratedValue` và `maskHistoryPasswords`); cờ lịch sử đặt qua toggle riêng trong Cài đặt.

---


## 5. Lược đồ lưu trữ & migration (plaintext ↔ vault)

### L-08 · Medium · Vault — `persist()` ghi **plaintext** khi vault bật nhưng đang khóa

**Vị trí:** `popup.js:1587-1601`

**Bằng chứng:**

```js
async function persist(key, value) {
  if (!vaultOn || !vaultKey || !vaultBlob) {          // 1588 — chỉ cần vaultOn=false là rơi vào đây
    chrome.storage.local.set({ [key]: value });       // 1589 — GHI THẲNG PLAINTEXT
    return;
  }
  vaultData[key] = value;
  const blob = await GPVault.reencrypt(vaultData, vaultKey, {...});   // 1593
  vaultBlob = blob;
  await chrome.storage.local.set({ genVault: blob });                 // 1600
}
```

**Tác động:** điều kiện dòng 1588 không phân biệt "kho chưa bật" với "kho **đã bật nhưng đang khóa**". Khi `vaultOn === false` (ví dụ ngay sau `vaultShowLock`, `popup.js:1342`), mọi lời gọi `persist()`/`persistKey()` sẽ ghi giá trị **dạng chữ rõ** vào `chrome.storage.local` — tạo **bản sao plaintext song song** với blob mã hóa. Blob vẫn là nguồn đọc khi mở khóa, nên bản plaintext trở thành **dữ liệu mồ côi nhưng vẫn rò rỉ at-rest** (đúng thứ mà vault sinh ra để chống). Đây cũng là mảnh ghép nguy hiểm với L-11.

**Cách sửa:** khi blob `genVault` tồn tại mà chưa mở khóa thì **throw/queue** thay vì ghi plaintext; chặn mọi thao tác ghi khi kho đang khóa ở cả tầng UI lẫn tầng `persist`.

---

### L-09 · Medium · Vault — Lost-update: popup và background mỗi bên mã hóa lại snapshot riêng

**Vị trí:** `popup.js:1592-1600`, `background.js:371-388`

```js
// popup.js — đọc/ghi vaultData trong bộ nhớ popup
vaultData[key] = value;
const blob = await GPVault.reencrypt(vaultData, vaultKey, {...});   // 1593 — mã hóa TOÀN BỘ vaultData
await chrome.storage.local.set({ genVault: blob });                 // 1600
```

```js
// background.js — đọc lại blob rồi cũng mã hóa TOÀN BỘ
Object.assign(ctx.data, partial);                                   // 379
const blob = await GPVault.reencrypt(ctx.data, ctx.key, {...});     // 381
await chrome.storage.local.set({ genVault: blob });                 // 387
```

**Tác động:** cả hai bên đều "read–modify–write" **toàn bộ** blob với ảnh chụp dữ liệu riêng. Nếu popup (đang mở) ghi `genHistory` bằng snapshot cũ **sau khi** background vừa lưu một mục 2FA mới, mục 2FA đó **biến mất**. Có giảm nhẹ: listener `chrome.storage.onChanged` trong popup giải mã blob mới và cập nhật `vaultData` (`popup.js:4277-4309`) — **nhưng** listener này **chỉ chạy khi `vaultOn && vaultKey`** (`popup.js:4277`), nên khi kho đang khóa hoặc khi 2 ghi xảy ra trong khung thời gian ngắn vẫn mất dữ liệu. Ngoài ra `save2FaCredential` thực hiện `vaultRead` rồi `vaultMutate` là **hai** lần giải mã riêng (`background.js:405,432`), mở rộng cửa sổ race.

**Cách sửa:** dùng khóa per-item (mỗi mục một khóa storage riêng, ví dụ `genVault:<id>`) thay vì blob gộp; hoặc serialize mọi ghi qua **một** context duy nhất (background) với hàng đợi; hoặc thêm version/ETag cho blob và retry khi phát hiện ghi đồng thời.

---

### L-10 · Medium · Storage — Hai lược đồ (plaintext / vault) dùng chung tên khóa, không có dấu phiên bản

**Vị trí:** `background.js:333-401`, `popup.js:1613`, `popup.js:1269-1283`

```js
const VAULT_KEYS = ["genHistory", "gen2FA", "genCards", "genCookieProfiles", "genTags"];   // background.js:333
```

Năm khóa này tồn tại ở **một trong hai** dạng: (a) khóa rời trong `chrome.storage.local` (chế độ plaintext), hoặc (b) trường bên trong blob `genVault` (chế độ vault). `vaultRead` chọn nguồn theo `ctx.vault` (`background.js:391-401`) và `vaultFill` chọn theo blob (`popup.js:1269-1283`). Không có khóa kiểu `schemaVersion`/`storageMode` độc lập, và **cả hai dạng có thể cùng tồn tại** (xem L-08). Hệ quả: khó phát hiện trạng thái hỗn hợp, dễ mất dữ liệu khi chuyển chế độ, không có cơ chế dọn dẹp khi phát hiện lệch.

**Cách sửa:** thêm `genStorageMode` (`"plain" | "vault"`) + `schemaVersion` trong `genOptions`, kiểm tra và **từ chối/thông báo** khi cả hai dạng tồn tại; dọn plaintext còn sót khi chế độ là vault.

---

### L-40 · Info · Migration — Khi bật vault: mã hóa + ghi đè rác + xóa plaintext **đã làm đúng** (điểm tốt)

**Vị trí:** `popup.js:1420-1455`

```js
async function vaultShredPlaintext() {
  const keys = ["genHistory", "gen2FA", "genCards", "genCookieProfiles", "genTags"];   // 1421
  const cur = await chrome.storage.local.get(keys);
  const junk = {};
  keys.forEach(k => {
    const len = JSON.stringify(cur[k] ?? []).length;
    if (len > 2) junk[k] = "x".repeat(len);      // 1426 — ghi rác cùng độ dài
  });
  if (Object.keys(junk).length) await chrome.storage.local.set(junk);   // 1428
  await chrome.storage.local.remove(keys);                              // 1429
}

async function vaultEnable(secret) {
  const blob = await GPVault.encryptWithPin(payload, secret);   // 1440
  await chrome.storage.local.set({ genVault: blob });           // 1443
  await vaultShredPlaintext();                                  // 1444 — mã hóa XONG mới xóa plaintext
```

**Đánh giá:** thứ tự đúng (mã hóa trước, ghi blob, rồi mới ghi rác + xóa plaintext), tránh mất dữ liệu nếu bước shred thất bại. Cần lưu ý đây là **giảm thiểu rủi ro**, không đảm bảo tuyệt đối (LevelDB/WAL vẫn có thể còn bản ghi cũ) — README (`README.md:201`) đã nói đúng mức độ. Điểm trừ nhỏ: `vaultEnable` chạy Argon2id **hai lần** (encrypt rồi unlock để lấy key, `popup.js:1440-1442`) — tốn ~2× thời gian.

---


## 6. Clipboard (auto-clear)

### L-05 · High · Clipboard — Thiếu quyền `clipboardRead` ⇒ auto-clear 30 giây không bao giờ chạy

**Vị trí:** `manifest.json:17-24`, `popup.js:966-980`, `content.js:639`

**Bằng chứng:**

```json
"permissions": [ "storage", "clipboardWrite", "activeTab", "contextMenus", "alarms", "cookies" ]
```

```js
function scheduleClipboardClear(text, seconds = 30) {
  if (!els.optAutoClearClipboard || !els.optAutoClearClipboard.checked || !text) return;   // 967
  if (clipboardClearTimer) clearTimeout(clipboardClearTimer);
  clipboardClearTimer = setTimeout(async () => {
    try {
      const current = await navigator.clipboard.readText();   // 971 — cần quyền "clipboardRead"
      if (current === text) {
        await navigator.clipboard.writeText("");              // 973
        showToast("Đã tự động xóa bộ nhớ tạm để bảo mật!");
      }
    } catch (err) {
      console.warn("Clipboard auto-clear error:", err);        // 977 — NUỐT LỖI, người dùng không biết
    }
  }, seconds * 1000);
}
```

**Tác động:** `navigator.clipboard.readText()` trên trang extension cần quyền **`clipboardRead`**, quyền này **không có** trong `manifest.json` ⇒ lời gọi **luôn reject** (`NotAllowedError`), rơi vào `catch` và bị nuốt ⇒ **clipboard không bao giờ được xóa**, dù checkbox "Tự động xóa clipboard sau 30 giây" đang bật mặc định (`popup.html:257`) và README (`README.md:25,105,193`) quảng bá tính năng này. Thêm hai vấn đề cùng chủ đề:

1. `setTimeout` chạy **trong context popup**; popup thường bị đóng sau khi người dùng copy ⇒ timer bị hủy, clipboard giữ nguyên mật khẩu.
2. Mật khẩu sinh từ **menu chuột phải** được copy ở content script (`content.js:639`) và **không hề** lên lịch xóa (không có mã auto-clear trong content.js).

**Cách sửa:** thêm `clipboardRead` vào manifest **hoặc** (tốt hơn về quyền hạn) chuyển việc xóa sang `chrome.alarms`/service worker; có thể chỉ cần **ghi đè** clipboard bằng chuỗi rỗng sau 30s (không cần đọc lại) để tránh phụ thuộc quyền; thêm auto-clear cho đường content script.

---


## 7. Autofill (content.js)

### L-14 · Medium · Autofill — Khớp domain "mờ" theo tên + guard kiểm `matching[0]` có thể lệch với mục được điền

**Vị trí:** `content.js:655-691` (menu chuột phải), `content.js:146-150` (badge)

**Bằng chứng:**

```js
const matching = history.filter(h => {
  const nameMatch = h.name && (h.name.toLowerCase() === domain || domain.includes(h.name.toLowerCase()));   // 660
  const urlMatch = h.url && h.url.toLowerCase().includes(domain);                                          // 661
  return nameMatch || urlMatch;
});

if (matching.length === 0) { ... }
const cred = matching[0];                                                        // 671
// Khớp domain thôi chưa đủ: có url thì phải cùng origin mới được điền
if (cred.url && !sameDomain(cred.url, location.href)) {                          // 673
  showInPageToast("GenPass: Không tìm thấy tài khoản đã lưu cho trang web này!");
  sendResponse({ success: false }); return;
}
```

```js
function sameDomain(a, b) {
  try { return new URL(a).hostname.replace(/^www\./i, "") === new URL(b).hostname.replace(/^www\./i, ""); }
  catch (e) { return false; }                                                    // content.js:17-23
}
```

**Tác động:** ba vấn đề độc lập:

1. **Khớp tên quá rộng:** `domain.includes(h.name.toLowerCase())` ⇒ mục đặt tên ngắn (`"a"`, `"go"`, `"bank"`) khớp với **mọi** host chứa chuỗi đó (`"google.com"` khớp `"go"`; `"mybank.vn"` khớp `"bank"`). Nếu mục đó **không có `url`** (nhập CSV thiếu cột URL), guard dòng 673 **bị vô hiệu** và credential được điền sang origin khác.
2. **Guard kiểm sai phần tử:** `cred = matching[0]` là mục đầu tiên khớp **theo bất kỳ tiêu chí nào**, không phải mục khớp domain. Nếu `matching[0]` không có `url` (⇒ guard pass) trong khi `matching[1]` mới đúng domain, hệ thống vẫn điền `matching[0]` — **điền sai tài khoản**.
3. **`urlMatch` dùng `includes` trên cả URL** (không phải hostname): `"https://evil.com/?next=bank.com"` chứa `"bank.com"` ⇒ khớp; guard dòng 673 chặn nếu `cred.url` tồn tại, nhưng vẫn là so khớp sai bản chất.

**Điểm tích cực:** `sameDomain` so **hostname** (không substring) nên không bị lỗi `bank.com.evil.com` khớp `bank.com`; IDN được `new URL()` chuẩn hóa punycode nên homograph Cyrillic **không** khớp ASCII (hướng an toàn). Vấn đề nằm ở **fallback theo tên** khi thiếu `url`.

**Cách sửa:** bỏ fallback theo tên khi điền credential; nếu bản ghi thiếu `url` thì coi là **không đủ điều kiện autofill**; chọn mục bằng chính bộ lọc `sameDomain(h.url, location.href)` **trước**, rồi mới lấy phần tử đầu tiên.

---

### L-15 · Medium · Autofill — Điền cùng 1 credential vào **mọi** ô password (kể cả "mật khẩu mới"/"xác nhận")

**Vị trí:** `content.js:154-195`

```js
const passInputs = Array.from(document.querySelectorAll('input[type="password"]'));   // 154
passInputs.forEach(passInput => {
  ...
  badge.addEventListener("click", (e) => {
    const cred = matching[0];                          // 183 — cùng một credential cho mọi ô
    setNativeValue(passInput, cred.password);          // 184
    const userInput = findUsernameInputElement(passInput);
    if (userInput && cred.username) setNativeValue(userInput, cred.username);
```

**Tác động:** badge xuất hiện trên **tất cả** ô password của trang, kể cả trang **đăng ký** (ô "Mật khẩu mới" + "Xác nhận mật khẩu"); bấm badge ở bất kỳ ô nào cũng điền **mật khẩu cũ đã lưu** (không điền được mật khẩu mới cho form đăng ký). Đây là lỗi nghiệp vụ rõ (sai ngữ cảnh), đồng thời là rủi ro điền nhầm vào ô "xác nhận".

Ngoài ra: badge chỉ gắn **một lần** lúc `DOMContentLoaded` (`content.js:825-829`) ⇒ ô password do SPA thêm sau đó **không** có badge; và mỗi ô password lại thêm 2 listener `resize`/`scroll` **không bao giờ gỡ** (`content.js:176-177`) ⇒ rò rỉ listener trên trang nhiều ô.

**Cách sửa:** chỉ gắn badge cho ô password **đăng nhập** (không có ô "xác nhận"/`autocomplete="new-password"`); dùng `MutationObserver` để gắn badge cho ô mới; gắn listener scroll/resize **một lần** ở cấp document.

---


### L-35 · Low · Autofill — Heuristic dò ô OTP quá rộng

**Vị trí:** `content.js:781-812`

```js
const otpInputs = allInputs.filter(i => {
  const attr = (i.name + " " + i.id + " " + i.autocomplete + " " + (i.placeholder || "")).toLowerCase();
  return ( attr.includes("one-time-code") || attr.includes("otp") || attr.includes("2fa") ||
           attr.includes("totp") || attr.includes("auth") || attr.includes("xác thực") ||
           attr.includes("mã") || i.maxLength === 6 || i.maxLength === 8 );      // 783-793
});
...
const singleDigitInputs = allInputs.filter(i => i.maxLength === 1);               // 799
if (singleDigitInputs.length === 6) { ... } else if (otpInputs.length > 0) { setNativeValue(otpInputs[0], cleanCode); }   // 800-811
```

**Tác động:** các heuristic khớp **quá rộng**, dẫn tới điền mã OTP vào ô không liên quan:

- `attr.includes("auth")` khớp `author`, `authentication-type`, `authorized`.
- `attr.includes("mã")` khớp `mã giảm giá` (coupon), `mã bưu chính` (postal code), `mã số thuế`.
- `i.maxLength === 6 || i.maxLength === 8` khớp **bất kỳ** ô 6/8 ký tự (mã xác nhận SMS, mã đơn hàng, CMND 8 số...).
- Nhánh "6 ô single-digit" kích hoạt chỉ dựa trên **số lượng** ô `maxLength === 1` (ví dụ 6 ô nhập ngày sinh/serial) mà không kiểm tra ngữ nghĩa.

**Cách sửa:** ưu tiên `autocomplete="one-time-code"` + `inputmode="numeric"` + pattern `[0-9]{6}`; chỉ dùng `maxLength` như tiêu chí **phụ** khi ô nằm trong form có dấu hiệu OTP; giới hạn `singleDigitInputs` trong cùng một container/form.

---

### Điểm tốt (phần autofill)

- `sameDomain` so **hostname** (đã bỏ `www.`) chứ không so substring ⇒ chống bẫy `bank.com.evil.com`; homograph IDN bị chuẩn hóa punycode nên **không** khớp ASCII (hướng an toàn).
- `setNativeValue` dùng **native value setter** + dispatch `input`/`change` (`content.js:82-95`) ⇒ điền được trên React/Vue 16+ như README nói.
- Có kiểm tra ô đang **hiện hình** trước khi điền (`isFillable`, `content.js:25-27`) và OTP chỉ điền ở **top frame** (`content.js:769-772`).
- Có chống lặp prompt lưu mật khẩu bằng `lastSubmittedCredentials` + TTL 10 giây (`content.js:215-218`).

---


## 8. Hồ sơ thanh toán / thẻ (cards)

### L-16 · Medium · Cards — Form thẻ trong popup **không** gọi `validateLuhn` (hàm chết) ⇒ lưu số thẻ sai

**Vị trí:** `popup.js:47-62` (định nghĩa), `popup.js:3642-3653` (nơi lưu)

**Bằng chứng:** `validateLuhn` **chỉ được định nghĩa**, không nơi nào trong `popup.js` gọi (kiểm tra bằng `grep`):

```
--- validateLuhn usages ---
popup.js:47:function validateLuhn(num) {
content.js:330:  function validateLuhn(num) {
content.js:379:        return clean.length >= 12 && clean.length <= 19 && validateLuhn(clean);
content.js:385:    if (rawNumber.length < 12 || !validateLuhn(rawNumber)) return null;
```

```js
const rawNumber = (els.inputCardNumber.value || "").replace(/\s+/g, "");   // 3644
if (!rawNumber) { showToast("Vui lòng nhập số thẻ!"); return; }            // 3645-3648
if (rawNumber.length < 12) { showToast("Số thẻ quá ngắn (tối thiểu 12 số)!"); return; }   // 3650-3653
```

**Tác động:** form thẻ chỉ kiểm tra **độ dài ≥ 12**; `"1111111111111111"` (không qua Luhn) vẫn được lưu ⇒ người dùng tin là số thẻ hợp lệ và sẽ thất bại khi thanh toán. README (`README.md:20`) quảng bá "Tích hợp kiểm tra Luhn checksum" — thực tế chỉ có ở luồng **tự động phát hiện** của content script (`content.js:379,385`), **không** ở form nhập tay.

**Cách sửa:** gọi `validateLuhn(rawNumber)` trong `btnSaveCard` (đã có sẵn hàm) và cảnh báo nhưng cho phép bỏ qua (một số thẻ Napas/ATM nội địa không theo Luhn).

---

### L-30 · Low · Cards — `validateExpiryDate` nhận thẻ đã hết hạn; format và validate không đối xứng

**Vị trí:** `popup.js:76-91`

```js
function validateExpiryDate(expiryStr) {
  if (!expiryStr || !/^\d{2}\/\d{2}$/.test(expiryStr)) return false;   // 85
  const [mmStr, yyStr] = expiryStr.split("/");
  const mm = parseInt(mmStr, 10);
  const yy = parseInt(yyStr, 10);
  if (mm < 1 || mm > 12) return false;
  return yy >= 0 && yy <= 99;                                         // 90 — KHÔNG so với ngày hiện tại
}
```

**Tác động (harness):**

```
validateExpiryDate("12/20") (expired 2020): true
formatExpiryDate("122") = 12/2 -> then validate: false
```

`"12/20"` (thẻ hết hạn từ 2020) được coi là **hợp lệ**. Ngoài ra `formatExpiryDate` cắt 4 chữ số rồi chèn `/` ở vị trí 3 (`popup.js:76-82`), nên `"122"` → `"12/2"` — vừa không khớp regex validate, vừa khiến người dùng bị kẹt (không tự sửa được ngoài việc gõ lại). Cũng không kiểm tra tháng/năm âm hay `00/00`.

**Cách sửa:** so `mm/yy` với tháng hiện tại; chuẩn hóa format khi blur (ví dụ `"122"` → `"12/2"` → tự pad thành `"12/02"` nếu người dùng rời ô).

---

### L-31 · Low · Cards — `maskCardNumber` ở popup che toàn bộ số, content.js lộ 4 số cuối; README nói lộ `1234`

**Vị trí:** `popup.js:70-74` (popup), `content.js:357-363` (content), `README.md:102`

```js
// popup.js
function maskCardNumber(num) {
  const clean = (num || "").replace(/\D/g, "");
  const masked = clean.replace(/\d/g, "•");     // 72 — che TẤT CẢ chữ số
  return masked.replace(/(.{4})(?=.)/g, "$1 ");
}
```

```js
// content.js
const last4 = clean.slice(-4);
const maskedPrefix = clean.slice(0, -4).replace(/\d/g, "•");
return (maskedPrefix + last4).replace(/(.{4})(?=.)/g, "$1 ");   // 361-362 — LỘ 4 số cuối
```

**Tác động (harness):**

```
popup mask 4242424242424242 = •••• •••• •••• ••••     (che hết)
content mask 4242424242424242 = •••• •••• •••• 4242   (lộ 4 số cuối)
```

Hai nơi hiển thị khác nhau, và README (`README.md:102`) tuyên bố định dạng `•••• •••• •••• 1234` — **không khớp** với popup. Đây là điểm không nhất quán (không phải lỗi bảo mật nghiêm trọng, vì popup che nhiều hơn).

**Cách sửa:** thống nhất một hàm hiển thị dùng chung; cập nhật README theo đúng hành vi.

---

### L-32 · Low · Cards — Không kiểm tra CVV/hạn; không chống trùng khi thêm tay; "Sao chép tất cả" đưa cả PAN + CVV vào clipboard

**Vị trí:** `popup.js:3642-3716`, `popup.js:3454-3475`

- `cvv` chỉ được `.trim()` (`popup.js:3663`), không kiểm tra độ dài/loại số (HTML giới hạn `maxlength="4"`); `expiryDate` **được phép rỗng** (`if (exp && !validateExpiryDate(exp))` — `popup.js:3656`).
- **Không** chống trùng khi thêm tay: mỗi lần lưu `currentCards.unshift(newCard)` (`popup.js:3707`); chỉ luồng autosave mới dedup theo `cardNumber` (`content.js:438`). Lưu cùng một thẻ hai lần tạo 2 bản ghi.
- `copyAllBtn` ghép toàn bộ thông tin gồm **số thẻ đầy đủ + CVV** thành văn bản rõ rồi ghi vào clipboard (`popup.js:3454-3475`); tính năng auto-clear đi kèm **không hoạt động** (xem L-05) ⇒ PAN+CVV nằm trong clipboard vô thời hạn.

**Cách sửa:** kiểm tra CVV (`/^\d{3,4}$/`), bắt buộc hạn thẻ; dedup theo số thẻ khi thêm tay; cảnh báo/không đưa CVV vào "Sao chép tất cả", hoặc ghi rõ rủi ro.

---

### Điểm tốt (phần thẻ)

- Nhận diện thương hiệu thẻ đúng cho các dải phổ biến: Visa `^4`, Mastercard `^(5[1-5]|2[2-7])`, Amex `^3[47]`, JCB `^35(2[89]|[3-8][0-9])`, Napas `^9704` (`popup.js:37-45`).
- `validateLuhn` **thuật toán đúng** (kiểm chứng: `4242424242424242` → true; `...243` → false) và chặn độ dài `<12`/`>19`.
- `formatCardNumber` nhóm 4 số đúng (`4242 4242 4242 4242`) và cắt 19 chữ số.
- Luồng autosave chỉ kích hoạt khi số thẻ **qua Luhn** (`content.js:379,385`) ⇒ hạn chế false positive.

---


## 9. Quản lý Cookies

### L-17 · Medium · Cookies — "Đăng xuất" xóa **toàn bộ** cookie domain **không có hộp thoại xác nhận**

**Vị trí:** `popup.js:4213-4247`

```js
if (els.btnClearDomainCookies) {
  els.btnClearDomainCookies.addEventListener("click", () => {          // 4214 — một cú click là xóa hết
    ...
    chrome.cookies.getAll({ url: activeTab.url }, async (cookies) => {
      if (!cookies || cookies.length === 0) { ... return; }
      for (const c of cookies) {
        const protocol = c.secure ? "https:" : "http:";
        const cleanDomain = c.domain ? c.domain.replace(/^\./, "") : extractDomain(activeTab.url);
        const cookieUrl = `${protocol}//${cleanDomain}${c.path || "/"}`;
        try { await chrome.cookies.remove({ url: cookieUrl, name: c.name }); }   // 4235
        catch (e) { console.warn("Cookie remove error:", e); }                   // 4237 — NUỐT LỖI
      }
      if (chrome?.tabs?.reload && activeTab.id) chrome.tabs.reload(activeTab.id);   // 4240-4242
      showToast(`Đã xóa ${cookies.length} cookies của trang & đăng xuất!`);         // 4243 — luôn báo thành công
    });
```

**Tác động:** thao tác **phá hủy** (đăng xuất khỏi mọi tài khoản của domain, mất giỏ hàng/phiên) chỉ cần **một cú click**, không có bước xác nhận, không có undo. Lỗi từng cookie bị nuốt (`console.warn`), và toast **luôn** báo `Đã xóa ${cookies.length} cookies` dù một số `remove` có thể đã thất bại (ví dụ `httpOnly` + scheme sai) ⇒ thông tin phản hồi sai sự thật. Ngoài ra `cookieUrl` được dựng thủ công từ `domain` + `path`; cookie có `domain` rỗng hoặc path lạ có thể tạo URL sai và bị bỏ qua âm thầm.

**Cách sửa:** thêm `confirm()`/modal xác nhận; đếm số cookie xóa **thành công** và báo chính xác; xử lý cookie `hostOnly`/domain rỗng bằng `chrome.cookies.remove` với `storeId` + URL gốc của tab.

---

### L-33 · Low · Cookies — `applyCookieProfile` không xóa cookie cũ của domain đích ⇒ "chuyển tài khoản" không thật sự sạch phiên

**Vị trí:** `popup.js:3997-4030`

```js
for (const c of cookies) {
  try { const clean = prepareCookieForSet(targetUrl, c); await chrome.cookies.set(clean); successCount++; }
  catch (e) { console.warn("Cookie set error:", e); }
}
if (activeTab?.id) {
  if (currentTabDomain && targetDomain && (currentTabDomain === targetDomain || ...)) {
    chrome.tabs.reload(activeTab.id);      // 4023
  } else if (chrome?.tabs?.create) {
    chrome.tabs.create({ url: targetUrl });   // 4025
  }
}
```

**Tác động:** nút "Chuyển sang phiên này" chỉ **ghi thêm** cookie từ profile đã lưu, **không xóa** cookie hiện có của domain (khác với luồng "Đăng xuất" ở L-17). Vì vậy các cookie phiên cũ (đặc biệt là cookie có tên nhưng khác giá trị, hoặc cookie mà profile mới không chứa) **vẫn còn** ⇒ trang có thể vẫn đăng nhập tài khoản cũ, hoặc trộn phiên của hai tài khoản → trải nghiệm "chuyển tài khoản" không đáng tin. Thêm nữa, so khớp domain dùng `includes` hai chiều (`popup.js:4022,3841,3792`) nên `example.com` có thể khớp `sub.example.com` (hướng có thể không mong muốn).

**Cách sửa:** trước khi `set`, xóa cookie hiện có của domain đích (cùng cách L-17) để đảm bảo phiên sạch; so khớp domain theo hostname chính xác (bỏ `www.`) thay vì `includes`.

---

### L-34 · Low · Cookies — Cookie hết hạn được truyền thẳng; lỗi bị nuốt; profile "Nhập JSON" bị dán nhãn domain sai

**Vị trí:** `popup.js:3738-3760`, `popup.js:4126-4185`

```js
if (c.expirationDate) clean.expirationDate = c.expirationDate;   // 3758 — không kiểm tra còn hạn hay không
```

```js
chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
  const activeTab = tabs?.[0];
  const domain = activeTab?.url ? extractDomain(activeTab.url) : "imported";   // 4144 — domain lấy từ TAB, không từ JSON
  const newProfile = { ..., domain, url: activeTab?.url || "", cookies: cookiesList, ... };   // 4145-4153
```

**Tác động:** (a) cookie có `expirationDate` đã qua được truyền vào `chrome.cookies.set` ⇒ API có thể từ chối, lỗi bị nuốt (`console.warn`) và người dùng không biết; (b) profile tạo từ JSON được gán `domain` = **domain của tab đang mở**, không phải domain thật của cookie ⇒ các chip lọc theo domain (`popup.js:3806`) và logic "chuyển phiên" có thể sai; (c) toast "Đã nhập & áp dụng N cookies" đếm `successCount` đúng (`popup.js:4164`) — điểm này tốt hơn L-17.

**Cách sửa:** bỏ qua (hoặc chuyển thành session) cookie đã hết hạn và báo cho người dùng; suy ra `domain` của profile nhập từ `cookiesList` (ví dụ domain phổ biến nhất) thay vì từ tab.

---

### Điểm tốt (phần cookies)

- Lưu/khôi phục phiên đúng các thuộc tính quan trọng: `domain` (chỉ khi `!hostOnly`), `path`, `secure`, `httpOnly`, `sameSite` (whitelist `no_restriction|lax|strict`), `expirationDate` (`popup.js:3738-3760`).
- Chặn thao tác trên trang hệ thống (`chrome://`, `edge://`) trước khi đọc cookie (`popup.js:4064,4195,4221`).
- Tự động reload tab sau khi áp dụng/nhập/xóa cookie.
- Có tìm kiếm và lọc theo domain cho danh sách phiên.

---


## 10. Độ bền vững chung, dead code, coercion

### L-18 · Medium · Robustness — Nhiều `navigator.clipboard.writeText(...)` không `.catch` ⇒ unhandled promise rejection

**Vị trí:** `popup.js:770,780,1971,1986,2006,2022,2132,2163,2544,3343,3374,3400,3419,3438,3472,3546,3562,3578,3966,4205`

**Bằng chứng (ví dụ):**

```js
passEl.addEventListener("click", () => {
  navigator.clipboard.writeText(item.password);   // 1986 — không await, không .catch
  scheduleClipboardClear(item.password);
```

`navigator.clipboard.writeText` trả về Promise; khi popup mất focus hoặc bị từ chối quyền, Promise **reject** và không ai bắt ⇒ `UnhandledPromiseRejection` (không hiển thị gì cho người dùng, nhưng gây nhiễu log và bỏ qua việc thông báo thất bại). Chỉ duy nhất nút Copy chính có `.then()` nhưng **vẫn không có `.catch`** (`popup.js:2544`).

Ngoài ra: `saveOptions` gọi `chrome.storage.local.set({ genOptions: opts })` (`popup.js:1225`) mà **không** quan tâm Promise/callback ⇒ lỗi quota (vượt `QUOTA_BYTES` 10MB) trở thành unhandled rejection và tùy chọn người dùng **mất im lặng**. `render2FA()` (async) được gọi từ `setInterval` (`popup.js:2199`) và `vaultView` (`popup.js:1328`) không `.catch`.

**Cách sửa:** tạo helper `copyToClipboard(text)` có `try/catch` + toast lỗi, dùng thống nhất; `saveOptions` trả Promise và xử lý lỗi (toast); bọc mọi lời gọi async trong timer/listener bằng `.catch(console.warn)`.

---

### L-36 · Low · Robustness — Nuốt lỗi rộng; `gpSet` của content script bỏ qua `res.ok === false`

**Vị trí:** `content.js:69-79`, `popup.js:731-733`, `popup.js:1587-1609`

```js
function gpSet(items, cb) {
  chrome.storage.local.get(["genOptions"], (o) => {
    if (!vaultEnabled(o)) { chrome.storage.local.set(items, cb); return; }
    chrome.runtime.sendMessage({ action: "vault_put", items: items }, (res) => {
      if (cb) cb(res || {});        // content.js:76 — không kiểm tra res.ok
    });
  });
}
```

Background trả `{ ok:false, locked:true }` khi vault đang khóa (`background.js:762-770`), nhưng content script **bỏ qua** `ok` ⇒ khi người dùng bấm "Lưu" trên prompt lưu mật khẩu trong lúc kho khóa, UI hiển thị "Đã lưu!" (`content.js:307-313`) nhưng **dữ liệu không được ghi** ⇒ mất mật khẩu mà người dùng tin là đã lưu. Tương tự, nhiều `catch {}` rỗng trong `generateTotp` (`popup.js:731-733`) và `vaultContext` (`background.js:364-367`) che giấu nguyên nhân.

**Cách sửa:** kiểm tra `res.ok` trong `gpSet` và phản hồi thất bại cho người dùng (toast "kho đang khóa"); thay `catch {}` rỗng bằng log có ngữ cảnh + thông báo khi ảnh hưởng dữ liệu.

---

### L-37 · Low · Robustness — Lạm dụng `parseInt(...) || 0` / `Number()` không nhất quán; `compareVersions` cắt hậu tố

**Vị trí:** `popup.js:1208-1218`, `popup.js:2565-2576`, `background.js:660-671`

```js
minNumbers: parseInt(els.minNumbers.value, 10) || 0,     // 1208 — "abc" → 0; "" → 0
minSpecial: parseInt(els.minSpecial.value, 10) || 0,     // 1209
passphraseWords: parseInt(els.passphraseWordsRange?.value, 10) || 4,   // 1210
vaultTimeoutMin: els.optVaultTimeout ? Number(els.optVaultTimeout.value) : 15,   // 1218 — Number() khác parseInt()
```

```js
const p1 = (v1 || "").split(".").map(n => parseInt(n, 10) || 0);   // 2566 — "0-beta" → 0
```

**Tác động:** (a) `parseInt("abc") || 0` biến giá trị rác thành `0` mà không báo — người dùng gõ chữ vào ô số sẽ âm thầm nhận giá trị 0; (b) trộn `parseInt` và `Number` cho cùng loại dữ liệu (min vs timeout) gây khó đoán; (c) `compareVersions` cắt hậu tố tiền phát hành (`1.2.0-beta` được coi bằng `1.2.0`) và bỏ qua tiền tố `v` — nếu upstream phát hành `v1.3.0` thì `parseInt("v1")` → `0` ⇒ **không phát hiện được bản mới** (banner cập nhật không hiện).

**Cách sửa:** dùng một hàm `toInt(v, fallback)` có kiểm tra `Number.isFinite`; viết lại `compareVersions` để strip tiền tố `v`, tách theo `.` và `-`, và so sánh đúng ngữ nghĩa semver.

---

### L-38 · Info · Dead code — Handler `vault_lock`/`vault_state` không nơi nào gửi; `validateLuhn` popup không dùng

**Vị trí:** `background.js:744-755`, `popup.js:47-62`

```js
if (msg.action === "vault_lock") {          // background.js:744 — grep toàn repo: không ai gửi
  chrome.storage.session.remove("genVaultKey");
  sendResponse({ ok: true });
  return;
}
if (msg.action === "vault_state") {         // background.js:750 — cũng không ai gửi
  vaultContext().then(ctx => { sendResponse({ enabled: ctx.vault != null, locked: !!ctx.locked }); });
  return true;
}
```

Kiểm tra bằng `grep -rn 'vault_lock\|vault_state' popup.js content.js background.js` chỉ ra **chỉ có nơi nhận, không có nơi gửi**. Tương tự `validateLuhn` trong popup.js là hàm chết (xem L-16). Dead code làm tăng bề mặt bảo trì và gây hiểu nhầm rằng có API khóa kho từ xa.

**Cách sửa:** xóa hoặc thực sự dùng (ví dụ gửi `vault_lock` từ popup khi người dùng bấm "Khóa ngay").

---

### L-39 · Info · Trùng lặp mã — 7 hàm bị sao chép ở 2-3 file với khác biệt tinh tế

| Hàm | popup.js | background.js | content.js | Khác biệt dẫn tới lỗi |
| :--- | :--- | :--- | :--- | :--- |
| `secureRandomInt` | 13-21 | 156-164 | — | Giống nhau (cùng dính L-19) |
| `base32Decode` | 678-699 | 188-207 | — | popup bỏ `=` cuối; bg bỏ **mọi** `=` |
| `parseOtpAuthUrl` | 736-762 | 237-260 | — | bg không kiểm host (L-26) |
| `detectCardBrand` | 37-45 | — | 347-355 | Giống nhau |
| `validateLuhn` | 47-62 (chết) | — | 330-345 | popup không dùng (L-16) |
| `maskCardNumber` | 70-74 | — | 357-363 | popup che hết, content lộ 4 số (L-31) |
| `compareVersions` | 2565-2576 | 660-671 | — | Giống nhau |

**Tác động:** đây chính là **nguồn gốc cấu trúc** của nhiều lỗi ở trên — sửa một bản không đồng nghĩa sửa bản kia. **Cách sửa:** gom vào một module dùng chung (ví dụ `lib/genpass-core.js` nạp bằng `importScripts` ở background và `<script>` ở popup).

---


## 11. Đối chiếu "đã triển khai" vs "chỉ quảng cáo" (README.md / task.md)

### 11.1 Tính năng **thực sự có** và hoạt động đúng

| Tính năng | Bằng chứng |
| :--- | :--- |
| Sinh mật khẩu ngẫu nhiên bằng CSPRNG, không bias (cho pool ≤ 2^32) | `popup.js:13-21` (rejection sampling), `secureShuffle` `popup.js:24-30` |
| Passphrase Diceware EFF **1296 từ** | `wordlist.js` (đã đếm: 1296 từ, 0 trùng), `popup.js:165-198` |
| Lọc ký tự dễ nhầm (`l 1 I \| O 0 o B 8`) | `popup.js:10,32-34,101-106` |
| TOTP RFC 6238 (SHA-1/6 số/30s) | `popup.js:701-734`, `background.js:210-233`; vector RFC 6238 → `287082` ✔ |
| Quét QR (jsQR + BarcodeDetector + crop/downscale nhiều lượt) | `popup.js:786-848`, `background.js:296-330` |
| Lịch sử: tìm kiếm, nhãn, sửa/xóa, giới hạn 200 | `popup.js:1797-2060,1743-1795` |
| Nhập/Xuất CSV (`name,url,username,password,note`) + escape đúng | `popup.js:2204-2315` |
| Ghi chú bảo mật (trường `note`) | `popup.js:110,1883-1888,2000-2011` |
| Hồ sơ thẻ: CRUD, nhận diện thương hiệu, che số, sao chép từng trường | `popup.js:3278-3716` |
| Cookies: lưu/chuyển/xuất/nhập/xóa phiên, giữ thuộc tính | `popup.js:3737-4247` |
| Context menu 2 cấp, song ngữ, đồng bộ khi đổi ngôn ngữ | `background.js:35-153` |
| Vault: Argon2id 64 MiB + AES-256-GCM + AAD, IV/salt ngẫu nhiên, blob v2 có kiểm định | `vault.js:15-166` |
| Tự khóa khi đóng popup (đếm cổng `vault-port`, không dựa vào task bất đồng bộ của popup) | `background.js:719-738`, `popup.js:2754-2759` |
| Ghi đè rác + xóa plaintext khi bật vault | `popup.js:1420-1455` |
| i18n VI/EN + chuyển đổi 1 chạm | `popup.js:430-632` |
| Kiểm tra cập nhật (GitHub raw, alarm 12h) | `background.js:673-717` |
| SSRF filter cơ bản cho fetch ảnh QR (còn lỗ hổng — xem `audit/security.md`) | `background.js:264-293` |

### 11.2 Tính năng **quảng cáo nhưng thực tế sai/thiếu** (quan trọng)

| Claim (nguồn) | Thực tế | Phát hiện |
| :--- | :--- | :--- |
| "Đảm bảo mỗi lớp ký tự được chọn đều xuất hiện" | Bị phá vỡ khi `length` < số ký tự bắt buộc | **L-01** |
| "Kiểm tra Luhn checksum" (`README.md:20`) | Form nhập tay **không** gọi `validateLuhn` (chỉ autosave có) | **L-16** |
| "Tự động xóa mật khẩu/mã OTP khỏi clipboard sau 30 giây" (`README.md:25,105,193`) | **Không hoạt động**: thiếu `clipboardRead`; timer chết khi đóng popup; đường context menu không lên lịch | **L-05** |
| "Chống Brute-force mã PIN" (`README.md:187`, `task.md:41`) | Lockout trong RAM, reset khi mở lại popup; không có tầng background; blob brute-force được offline | **L-04** |
| "Tự khóa sau 5/15/30 phút **không dùng**" (`README.md:178`) | Heartbeat 20s gia hạn liên tục khi popup mở ⇒ không tự khóa | **L-28** |
| Số thẻ hiển thị `•••• •••• •••• 1234` (`README.md:102`) | Popup che **toàn bộ** chữ số | **L-31** |
| "Tự động điền tài khoản đã lưu (theo trang)" (`README.md:75`) | Fallback khớp theo **tên mờ** + guard kiểm sai phần tử ⇒ có thể điền sang origin khác | **L-14** |
| "Chuẩn RFC 6238 (mã 6 số, chu kỳ 30s)" (`README.md:17`) | Đúng với SHA-1/6 số/30s, nhưng **bỏ qua** `digits`/`period`/`algorithm` của `otpauth://` ⇒ sai với 8 số/60s/SHA-256 | **L-03** |
| "Tự động loại bỏ mục trùng lặp" (CSV, `README.md:122`) | Đúng cho CSV; nhưng lưu runtime lại **gộp nhầm** hai site | **L-02** |
| "100% Ngoại tuyến (Zero Telemetry)" (`README.md:185`) | Có gọi mạng: `img.vietqr.io` (tab Ủng hộ, `popup.js:645-654`) và `raw.githubusercontent.com` (kiểm tra cập nhật, `background.js:675`) — không phải telemetry nhưng **không** phải "không gửi ra máy chủ bên thứ ba" (`README.md:7`) | Info (đã ghi ở `audit/security.md`) |
| "Tự khóa ngay khi đóng popup" (mặc định) | **Đúng** — nhưng chỉ khi `vaultLockClose` bật (`popup.js:1618`, `background.js:733`) | Điểm tốt |

### 11.3 Kiểm thử: độ tin cậy thấp ở đúng các vùng rủi ro

- `tests/security-i18n.test.cjs:61-63`: kiểm tra rate-limit **chỉ bằng `includes()` trên chuỗi mã nguồn** ⇒ **pass dù tính năng hỏng** (xem L-04).
- Không có test nào chạy `generatePassword()` với `length` nhỏ + nhiều lớp ký tự ⇒ **L-01 không bị phát hiện**.
- Không có test cho `otpauth://` với `digits`/`period`/`algorithm` ⇒ **L-03 không bị phát hiện**.
- Không có test cho `saveHistoryItem` với hai site khác nhau cùng mật khẩu ⇒ **L-02 không bị phát hiện**.
- `task.md:57-59` báo "PASS 15/15", "PASS 10/10 (105/105 checks)" — các test này (do `perf-tests` kiểm chứng độc lập) tập trung vào crypto/vòng đời session, **không** phủ các nhánh logic nghiệp vụ nêu trên.

---


## 12. Những điều **không thể kiểm chứng** trong môi trường này (nói rõ để tránh hiểu sai)

1. **Hành vi thật của `navigator.clipboard.readText()` trong Chrome**: kết luận "auto-clear hỏng" (L-05) dựa trên (a) `manifest.json` thiếu `clipboardRead` và (b) tài liệu quyền hạn của Chrome cho trang extension. Tôi **chưa chạy Chrome thật** trong phiên này để quan sát `NotAllowedError`. Cần xác nhận bằng cách chạy extension trong Chrome với DevTools console.
2. **Mức độ rò rỉ thật từ LevelDB sau `vaultShredPlaintext`**: kết luận chỉ ở mức "giảm thiểu rủi ro" (L-40) theo đúng cách README mô tả; tôi **không** kiểm tra dấu vết còn lại trong file LevelDB/WAL.
3. **Race condition L-09**: là phân tích theo trình tự đọc–ghi mã nguồn (popup và background là hai context thật, có thể chạy song song). Tôi **chưa** tạo được tình huống tranh chấp thật để tái hiện mất dữ liệu; mức độ = Medium (theo lý thuyết, có cơ chế giảm nhẹ qua `storage.onChanged`).
4. **Hiệu năng / thời gian Argon2id thực tế** trên máy người dùng (ảnh hưởng khả năng brute-force offline): không đo được ở đây (thuộc phạm vi `perf-tests`).
5. **Hành vi của `chrome.cookies.set` với cookie hết hạn / `sameSite` không hợp lệ**: suy luận từ API, chưa chạy thật.
6. **Các thư viện vendor** (`jsqr.js`, `vendor/hash-wasm.umd.js`): không đánh giá nội dung (ngoài phạm vi logic nghiệp vụ; thuộc `audit/security.md`).
7. **IDN/homograph**: kết luận "không khớp ASCII" dựa trên hành vi chuẩn hóa punycode của `new URL()`; chưa thử với tên miền IDN thật.
8. **`clipboardWrite` từ content script** (`content.js:639`): một số trình duyệt chỉ cho ghi clipboard khi document đang focus; tôi chưa xác minh được liệu menu chuột phải có luôn ghi thành công.

---

## 13. Điểm tốt (tổng hợp, đã xác nhận bằng mã/đo)

1. **Chất lượng ngẫu nhiên đúng**: rejection sampling không bias (`popup.js:15-20`), Fisher–Yates với CSPRNG (`popup.js:24-30`), không dùng `Math.random()` ở bất kỳ đâu trong luồng sinh mật khẩu/OTP (đã `grep`).
2. **TOTP đúng chuẩn** và đã kiểm chứng bằng vector RFC 6238; chuẩn hóa đầu vào (chữ thường, khoảng trắng, padding) tốt.
3. **Vault crypto vững**: Argon2id (t=3, m=64 MiB, p=4, 32 byte), AES-256-GCM tag 128 bit, **AAD gắn phiên bản blob** chống tráo/rollback (`vault.js:18,112-129`), key `extractable=false` (`vault.js:92`), kiểm định blob chặt (`vault.js:95-109`).
4. **Khóa phiên đặt đúng chỗ**: `chrome.storage.session` + `setAccessLevel("TRUSTED_CONTEXTS")` (`background.js:27-32`) ⇒ content script **không** đọc được key; thu hồi khi đóng popup cuối cùng (đếm cổng) và khi hết hạn (`background.js:719-738,346-358`).
5. **Migration khi bật vault đúng thứ tự** (mã hóa trước → ghi blob → ghi rác → xóa plaintext) — L-40.
6. **Chống prompt trùng** khi lưu mật khẩu/thẻ bằng TTL 10s (`content.js:215-218,441-444`).
7. **Autofill an toàn theo hostname** (không substring), chống `bank.com.evil.com`; OTP chỉ điền top frame.
8. **`setNativeValue`** đúng kỹ thuật cho React/Vue.
9. **Giới hạn 200 mục** áp dụng nhất quán ở mọi đường ghi; CSV escape đúng chuẩn.
10. **Không tìm thấy** `eval`, `new Function`, `document.write`, hay `setTimeout(string)` trong mã extension (đã `grep`).

---

## 14. Phụ lục — Cách tái lập các bằng chứng đã chạy

Tất cả harness đều **trích nguyên văn** hàm từ mã nguồn bằng `fs.readFileSync(...).slice(...)` / `eval`, **không sửa** file dự án. Tóm tắt:

| Harness | Nguồn hàm | Kết luận |
| :--- | :--- | :--- |
| `/tmp/verify1.cjs` | `popup.js:13-21,24-30,32-34,93-153,155-163,1188-1195` | L-01 (bỏ lớp ký tự), L-06 (overstate entropy), L-07 (min vượt length), L-19 (limit=0 khi max>2^32) |
| `/tmp/verify2.cjs` | `popup.js:678-699`, `background.js:188-207`, công thức TOTP `popup.js:701-734` | TOTP vector RFC 6238 = `287082` ✔; ký tự sai bị bỏ qua (L-13) |
| `/tmp/verify3.cjs` | `popup.js:736-762`, `background.js:237-260` | L-03 (bỏ `digits/period/algorithm`), L-26 (hotp/TOTP case) |
| `/tmp/verify4.cjs` | `popup.js:64-91`, `content.js:357-363` | L-30 (nhận thẻ hết hạn), L-31 (mask khác nhau) |
| `/tmp/verify5.cjs` | `popup.js:1735-1795` | L-02 (gộp nhầm hai site) |
| Lệnh đếm wordlist | `wordlist.js` | 1296 từ, 0 trùng lặp ✔ |

---

## 15. Ưu tiên khắc phục đề xuất (theo mức độ nghiêm trọng)

| Ưu tiên | Phát hiện | Lý do |
| :--- | :--- | :--- |
| **P0** | L-01, L-02 | Sai/ mất dữ liệu mật khẩu trực tiếp, người dùng không biết |
| **P0** | L-03, L-13 | TOTP sai âm thầm ⇒ người dùng không đăng nhập được, có thể bị khóa tài khoản |
| **P0** | L-05 | Tính năng bảo mật quảng cáo rõ ràng nhưng không hoạt động |
| **P1** | L-04, L-11, L-08, L-09, L-10 | Toàn vẹn/bảo mật at-rest của kho |
| **P1** | L-14, L-15, L-16, L-17 | Điền sai origin, lưu thẻ sai, xóa cookie không xác nhận |
| **P2** | L-06, L-07, L-12, L-24, L-25, L-26, L-27, L-28, L-29, L-30, L-31, L-32, L-33, L-34, L-35, L-36, L-37 | Đúng đắn/UX, rủi ro thấp–trung bình |
| **P3** | L-18, L-19, L-20, L-21, L-22, L-23, L-38, L-39, L-40 | Vệ sinh mã, phòng thủ, tài liệu |

---

*Hết báo cáo. Người thực hiện: `logic-core` (Senior Engineer — Business Logic Audit). Mọi phát hiện đều truy vết được về `file:line` trong commit `b4a9b7f`.*

