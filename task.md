# Kế hoạch & Nhật ký công việc: GenPass Security Hardening, Donate & Full i18n

## 1. Mục tiêu (Objective)
- Khảo sát và giải đáp minh bạch về ranh giới bảo mật, khả năng phòng chống virus/mã độc của tiện ích GenPass.
- Tích hợp thông tin ủng hộ (Donate) với mã VietQR Napas 24/7 và thông tin ngân hàng Techcombank lấy từ repo `vibe-agent-hub`.
- Thêm nhận diện GitHub và giấy phép bản quyền.
- Triển khai hỗ trợ song ngữ toàn diện (Full i18n Tiếng Việt & Tiếng Anh).
- Tăng cường bảo mật: vá lỗ hổng SSRF trong quá trình quét QR ảnh và cơ chế chống brute-force mã PIN kho mã hóa.
- Cập nhật tài liệu `README.md` (Tiếng Việt) và tạo mới bản tiếng Anh `README_EN.md`.

---

## 2. Danh sách đầu việc chi tiết (Tasks)

- [x] **Task 1: Khảo sát thông tin chuyển khoản từ repo `vibe-agent-hub`**
  - Trích xuất thông tin từ `vibe-agent-hub/src/data/hubData.js`:
    - Ngân hàng: Techcombank
    - Số tài khoản: `1005555555555`
    - Chủ tài khoản: `LE NGOC TUONG`
    - Nội dung chuyển khoản: `GenPass Ung Ho`
    - URL VietQR: `https://img.vietqr.io/image/TCB-1005555555555-qr_only.png?amount=0&addInfo=GenPass%20Ung%20Ho&accountName=LE%20NGOC%20TUONG`

- [x] **Task 2: Tích hợp Tab Ủng hộ & Nhận diện GitHub**
  - File chỉnh sửa: `popup.html`, `popup.css`, `popup.js`
  - Bổ sung nút tab `#tab-about` và khung hiển thị `#view-about`.
  - Hiển thị logo, phiên bản manifest, nút liên kết GitHub repo (`https://github.com/lengoctuong2005/GenPass`) và Giấy phép MIT.
  - Hiển thị mã VietQR trực tiếp kèm cơ chế xử lý lỗi khi mất mạng.
  - Hiển thị bảng thông tin tài khoản Techcombank với nút sao chép nhanh 1 chạm cho STK và nội dung chuyển khoản.
  - Hỗ trợ vị trí cấu hình PayPal link qua hằng số `DONATE_INFO.paypalUrl` (mặc định tạm ẩn khi chưa có URL).

- [x] **Task 3: Triển khai hệ thống đa ngôn ngữ toàn diện (Full i18n)**
  - File chỉnh sửa: `popup.html`, `popup.css`, `popup.js`, `background.js`
  - Thêm nút chuyển đổi nhanh `#btn-lang-toggle` (VI | EN) trên thanh tiêu đề header.
  - Xây dựng từ điển song ngữ `I18N` trong `popup.js` với 80+ cặp khóa phủ toàn bộ giao diện (tabs, buttons, inputs, placeholders, titles, toasts, strength meters).
  - Tự động lưu và phục hồi lựa chọn ngôn ngữ qua `chrome.storage.local`.
  - Bổ sung cơ chế đồng bộ ngôn ngữ cho Context Menus chuột phải trong `background.js`.

- [x] **Task 4: Tăng cường bảo mật chuyên sâu (Security Hardening)**
  - File chỉnh sửa: `background.js`, `popup.js`
  - **Vá lỗi SSRF trong `background.js`**: Thêm hàm kiểm tra `isSafeFetchUrl(urlStr)` chặn hoàn toàn việc fetch các địa chỉ IP nội bộ (`127.0.0.1`, `localhost`, `0.0.0.0`, `10.*`, `192.168.*`, `172.16-31.*`, `169.254.*`, `::1`) khi quét mã QR từ ảnh trang web.
  - **Chống Brute-force mã PIN trong `popup.js`**: Bổ sung biến theo dõi `vaultFailedAttempts` và `vaultLockoutUntil`, tự động khóa tạm thời 15 giây khi người dùng nhập sai PIN liên tiếp 5 lần trở lên.

- [x] **Task 5: Cập nhật tài liệu kỹ thuật & Hướng dẫn**
  - File chỉnh sửa/tạo mới: `README.md`, `README_EN.md`
  - Làm rõ mô hình đe dọa (Threat Model): Giải thích cặn kẽ ranh giới bảo vệ của tiện ích (bảo vệ at-rest, chống trích xuất LevelDB, chống phishing, chống clipboard leak) và những gì tiện ích không thể bảo vệ (mã độc/virus cấp hệ điều hành, keylogger, trojan chiếm quyền OS).
  - Bổ sung hướng dẫn đóng góp, thông tin chuyển khoản Techcombank và quét mã VietQR.
  - Tạo tệp `README_EN.md` chuẩn hóa đầy đủ bằng tiếng Anh.

- [x] **Task 6: Tối ưu thanh trượt Taskbar & Bố cục Header**
  - Tách header thành 2 hàng độc lập: Hàng trên gồm Brand "GenPass" và nút chuyển ngôn ngữ "VI | EN"; Hàng dưới là thanh taskbar tabs toàn chiều rộng (`416px`).
  - Toàn bộ 6 nút tab (Mật khẩu, Lịch sử, 2FA, Thanh toán, Cookies, Ủng hộ) hiển thị trọn vẹn, không còn bị co dúm hay khuất chữ "Cookies".
  - Bổ sung thanh trượt slider mỏng tinh tế (`3px` scrollbar track & thumb).
  - Thêm cuộn ngang mượt mà bằng con lăn chuột (Mouse wheel horizontal scroll) và cơ chế tự động cuộn nút tab đang chọn vào khung nhìn (`scrollIntoView`).

- [x] **Task 7: Kiểm thử tự động & Nghiệm thu (Verification & DoD)**
  - Tạo mới bộ kiểm thử `tests/security-i18n.test.cjs`.
  - Chạy `tests/security-i18n.test.cjs`: PASS 4/4 nhóm kiểm thử (14/14 test cases SSRF).
  - Chạy `tests/vault.test.cjs`: PASS 15/15 tests (Argon2id, AES-256-GCM, AAD).
  - Chạy `tests/integration.test.cjs`: PASS 10/10 flows tích hợp (105/105 checks).

- [x] **Task 8: Vá bảo mật cốt lõi & Nâng cấp v1.4.0**
  - Vá lỗi SSRF qua địa chỉ IPv6-mapped IPv4 và chặn redirect HTTP 302 qua `{ redirect: "error" }`.
  - Bảo vệ messaging API và port `vault-session`: chặn content script web chiếm dụng hoặc khóa kho trái phép; lọc `genHistory` theo origin tab web.
  - Chống CSV Formula Injection (CWE-1236) khi xuất file CSV.
  - Sửa lỗi lọc trùng khi nhập CSV (deduplicate theo tài khoản, không bỏ sót tài khoản trùng mật khẩu).
  - Bổ sung kiểm tra Luhn checksum và hạn thẻ tín dụng khi lưu.
  - Lưu trữ bộ đếm thử PIN và thời gian khóa tạm vào `chrome.storage.session`.
  - Bổ sung quyền `unlimitedStorage` và `clipboardRead` vào `manifest.json`.

- [x] **Task 9: Tích hợp tính năng cao cấp (v1.4.0)**
  - **Kiểm tra mật khẩu bị lộ qua HaveIBeenPwned API (k-Anonymity)**: Băm SHA-1 mật khẩu, gửi 5 ký tự đầu để đối chiếu ẩn danh, hiển thị badge cảnh báo rò rỉ tức thì.
  - **Sao lưu & Khôi phục kho mã hóa (.gpvault)**: Xuất và nhập kho dữ liệu mã hóa nguyên khối (AES-256-GCM + Argon2id), an toàn tuyệt đối khi lưu trữ đám mây.
  - **Hỗ trợ toàn diện RFC 6238 TOTP**: Hỗ trợ SHA-1/SHA-256/SHA-512, mã 6/8 chữ số và chu kỳ thời gian tùy chỉnh.

---

## 3. Bằng chứng kiểm thử (Verification Evidence)

1. **`node --test tests/*.test.cjs`**:
   - `✓ tests/features-v14.test.cjs (4/4 groups passed)`
   - `✓ tests/security-i18n.test.cjs (4/4 groups, 17/17 SSRF tests passed)`
   - `✓ tests/suggest-password.test.cjs (10/10 groups passed)`
   - `✓ tests/vault.test.cjs (18/18 checks passed)`
   - `✓ tests/integration.test.cjs (10/10 flows, 105/105 checks passed)`
   - `Total: 19/19 test suites PASS, 0 FAIL`

2. **`node tests/e2e-chrome.cjs` (CDP Chrome thật)**:
   - `11/11 scenarios PASS (S0 -> S10), 0 FAIL`

3. **`node tests/cookie-e2e.cjs` (Cookie E2E Chrome thật)**:
   - `10/10 scenarios PASS (S1 -> S10), 0 FAIL`

---

## 3. Bằng chứng kiểm thử (Verification Evidence)

1. **`node tests/security-i18n.test.cjs`**:
   - `✓ SSRF filter tests passed (14/14)`
   - `✓ Donate & GitHub verification passed`
   - `✓ i18n dictionary completeness passed (80 matching bilingual keys)`
   - `✓ Vault PIN rate-limiting logic present`
   - `ALL SECURITY & i18n TESTS PASSED! (4/4 test groups)`

2. **`node tests/vault.test.cjs`**:
   - `15/15 tests pass (0 fail, 0 cancelled, 0 skipped)`
   - `duration_ms: ~5100ms`

3. **`node tests/integration.test.cjs`**:
   - `10/10 flows pass (T1, T2, T3, T3b, T4, T6, T5, T8, T7, T9)`
   - `105/105 checks ok (exit code 0)`
