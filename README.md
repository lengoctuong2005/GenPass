# GenPass - Trình Tạo Mật Khẩu & Xác Thực 2FA (TOTP)

GenPass là tiện ích mở rộng trình duyệt (Chrome Extension Manifest V3) mã nguồn mở, hoạt động ngoại tuyến 100%. Tiện ích kết hợp giữa trình tạo mật khẩu theo chuẩn ngành (hỗ trợ cả mật khẩu ký tự ngẫu nhiên và cụm từ Passphrase Diceware), trình xác thực hai lớp 2FA/TOTP chuẩn RFC 6238, ghi chú bảo mật (Secure Notes) và hệ thống menu chuột phải tiện lợi.

Toàn bộ dữ liệu được lưu trữ cục bộ trên máy của bạn qua `chrome.storage.local`, không gửi ra bất kỳ máy chủ bên thứ ba nào.

---

## Bảng tính năng chính

| Nhóm tính năng | Chi tiết hỗ trợ |
| :--- | :--- |
| **Mật khẩu ngẫu nhiên** | Độ dài 5 - 64 ký tự, Chữ hoa, Chữ thường, Số, Ký tự đặc biệt, lọc ký tự dễ nhầm (`l`, `1`, `I`, `0`, `O`...). |
| **Cụm từ Passphrase** | Chuẩn Diceware EFF 1,296 từ dễ nhớ, tùy chọn 3 - 10 từ, ký tự phân cách (`-`, `_`, `.`, khoảng trắng), viết hoa chữ đầu, kèm số ngẫu nhiên. |
| **Xác thực 2FA (TOTP)** | Tương tự các ứng dụng xác thực phổ biến, chuẩn RFC 6238 (mã 6 số, chu kỳ 30s). Nhập khóa Base32, link `otpauth://`, tải ảnh QR hoặc quét trực tiếp màn hình. |
| **Quét mã QR đa nền tảng** | Tích hợp bộ giải mã thuần JavaScript `jsQR`, hoạt động ổn định trên cả Windows, macOS, Linux mà không phụ thuộc API trình duyệt. |
| **Ghi chú bảo mật (Secure Notes)** | Lưu mã backup 2FA (8 ký tự), mã PIN, câu hỏi bảo mật kèm theo tài khoản. Hỗ trợ tìm kiếm và sao chép nhanh 1 chạm. |
| **Hồ sơ thanh toán (Google Pay, PayPal, Thẻ)** | Lưu trữ thẻ tín dụng/ghi nợ (Visa, Mastercard, JCB, Amex, Napas...) kèm thông tin thanh toán chuẩn Google Pay / PayPal (Họ tên, Số thẻ, CVV, Hạn thẻ, Địa chỉ đường, Thành phố, Bang/Tỉnh, Zip/Postal code, Email, SĐT). Tích hợp kiểm tra Luhn checksum, che số thẻ và nút sao chép toàn bộ thông tin. |
| **Quản lý Cookies & Chuyển phiên tài khoản** | Quản lý phiên đăng nhập nhiều tài khoản (Multi-Account Session Switcher) theo domain hoàn toàn cục bộ: lưu phiên hiện tại, chuyển đổi tài khoản 1-chạm kèm reload trang, xuất/nhập danh sách cookies dạng JSON chuẩn Cookie-Editor, xóa cookies để đăng xuất nhanh. |
| **Quản lý lịch sử & Tìm kiếm** | Lưu tối đa 200 mục gần nhất, phân loại theo nhãn tag, hiển thị rõ ràng Tên đăng nhập / Email và Tên nền tảng. Thanh tìm kiếm thời gian thực (Live Search). |
| **Menu chuột phải (Context Menu)** | Click chuột phải để tạo mật khẩu theo loại, quét mã QR từ ảnh hoặc toàn màn hình, tự động điền tài khoản hoặc mã OTP. |
| **Tương thích React/Vue 16+** | Sử dụng Native Value Setter descriptor để tự động điền không bị lỗi nuốt chữ trên form React/Vue. |
| **Bảo mật bộ nhớ tạm** | Tự động xóa mật khẩu hoặc mã OTP khỏi clipboard sau 30 giây nếu người dùng chưa copy nội dung mới. |
| **Kiểm tra cập nhật tự động** | Tự động kiểm tra bản mới từ GitHub định kỳ, hiển thị huy hiệu `NEW` khi có phiên bản cập nhật. |
| **Xuất/Nhập CSV** | Định dạng CSV phổ biến của các trình quản lý mật khẩu (`name,url,username,password,note`). |

---

## Hướng dẫn cài đặt

Tiện ích tương thích với tất cả trình duyệt nhân Chromium hiện đại (Google Chrome, Microsoft Edge, Brave, Cốc Cốc, Opera).

### Cài đặt từ mã nguồn (Chế độ Nhà phát triển)

1. Tải về hoặc clone kho lưu trữ:
   ```bash
   git clone https://github.com/lengoctuong2005/GenPass.git
   ```
2. Mở trình duyệt và truy cập trang quản lý tiện ích:
   - Google Chrome / Brave / Cốc Cốc: `chrome://extensions`
   - Microsoft Edge: `edge://extensions`
3. Bật công tắc **Chế độ dành cho nhà phát triển** (Developer mode) ở góc trên bên phải màn hình.
4. Nhấn nút **Tải tiện ích đã giải nén** (Load unpacked) ở góc trên bên trái.
5. Chọn thư mục `GenPass` vừa tải về để hoàn tất cài đặt.

---

## Hướng dẫn sử dụng chi tiết

### 1. Tạo mật khẩu hoặc Cụm từ Passphrase
1. Bấm vào biểu tượng GenPass trên thanh công cụ trình duyệt.
2. Tại tab **Tạo mật khẩu**, chọn chế độ:
   - **Mật khẩu (Password)**: Kéo thanh trượt để chọn độ dài và bật/tắt các loại ký tự mong muốn.
   - **Cụm từ (Passphrase)**: Chọn số lượng từ (mặc định 4 từ), dấu phân cách (dấu gạch ngang, gạch dưới, khoảng trắng...) và tùy chọn viết hoa hoặc kèm số.
3. Điền Tên dịch vụ (ví dụ: `Facebook`), Tên đăng nhập (ví dụ: `alice@gmail.com`), chọn Nhãn phân loại và Ghi chú bảo mật nếu cần.
4. Nhấn nút **Sao chép**: Mật khẩu sẽ được sao chép vào bộ nhớ tạm và tự động ghi nhớ vào mục Lịch sử.

### 2. Sử dụng Menu chuột phải (Context Menu)
Khi lướt web, bạn có thể click chuột phải vào trang để gọi menu `GenPass`:
- **Tạo mật khẩu**:
  - Mật khẩu chuẩn (16 ký tự).
  - Cụm từ dễ nhớ (Passphrase 4 từ).
  - Mật khẩu siêu dài (32 ký tự).
  - Chữ & số (12 ký tự - phù hợp cho ngân hàng hoặc cổng đăng ký khắt khe).
  - Mã PIN số (6 số).
  *(Mật khẩu vừa tạo sẽ tự động được điền vào ô đang trỏ chuột và copy vào clipboard)*.
- **Quét mã QR 2FA**:
  - *Quét từ ảnh này*: Click chuột phải trực tiếp vào hình ảnh mã QR trên màn hình.
  - *Quét toàn bộ trang web này*: Tự động chụp lại tab hiện tại và tìm mã QR để lưu mà không cần mở popup.
- **Tự động điền**:
  - *Điền tài khoản đã lưu (theo trang)*: Tự động điền tài khoản và mật khẩu khớp với domain hiện tại.
  - *Điền mã OTP 2FA mới nhất*: Tự động tính toán mã 6 số hiện tại và điền vào ô OTP trên trang.

### 3. Quản lý mã 2FA / TOTP
1. Mở tab **Mã 2FA** trong popup GenPass.
2. Thêm khóa xác thực bằng 3 cách:
   - Bấm **+ Thêm** để dán khóa bí mật Base32 hoặc link `otpauth://`.
   - Bấm **Quét QR** để quét mã QR đang hiển thị trên màn hình trang web hiện tại.
   - Bấm **Tải ảnh** để chọn file ảnh QR lưu trên máy.
3. Khi đăng nhập trang web, bấm vào dãy số 6 chữ số để sao chép hoặc bấm nút **Điền vào web**.

### 4. Tra cứu lịch sử & Ghi chú bảo mật
1. Mở tab **Lịch sử**.
2. **Tìm kiếm thời gian thực (Live Search)**: Gõ vào ô tìm kiếm tên nền tảng (`facebook`), tên đăng nhập (`alice@gmail.com`), URL hoặc nội dung ghi chú bảo mật (`mã backup`, `pin`) để lọc ngay lập tức.
3. **Sao chép nhanh**:
   - Bấm vào mật khẩu để sao chép mật khẩu.
   - Bấm vào dòng `👤 [Tài khoản]` để sao chép tên đăng nhập.
   - Bấm vào thẻ `📝 [Ghi chú]` để sao chép ghi chú.
4. **Chỉnh sửa**: Bấm nút cây bút chì để đổi Tên, Tài khoản, Nhãn và Ghi chú bảo mật.

### 5. Quản lý Hồ sơ thanh toán (Google Pay, PayPal, Thẻ tín dụng/ghi nợ)
1. Mở tab **Thanh toán**.
2. Nhấn nút **+ Thêm hồ sơ** để nhập:
   - **Thông tin thẻ**: Tên hồ sơ (ví dụ: `Google Pay Visa`, `PayPal MB Bank`), Tên chủ thẻ (in hoa: `NGUYEN VAN A`), Số thẻ (nhận diện thương hiệu Visa, Mastercard, JCB, Amex, Napas, tự động nhóm 4 số), Ngày hết hạn (`MM/YY`), Mã CVV/CVC (có nút ẩn/hiện mắt).
   - **Địa chỉ thanh toán chuẩn quốc tế (Google Pay / PayPal)**: Email thanh toán, Số điện thoại, Địa chỉ đường/Số nhà, Thành phố (City), Bang/Tỉnh (State/Province), Mã bưu chính (Zip/Postal Code - ví dụ: `100000`, `94043`), Quốc gia (`VN`, `US`...).
   - **Ghi chú bảo mật**: PIN thẻ ATM, chi nhánh ngân hàng.
3. **Thao tác nhanh và bảo mật**:
   - Số thẻ hiển thị dạng che bảo mật `•••• •••• •••• 1234`. Nhấn icon mắt để ẩn/hiện hoặc click để copy số thẻ.
   - Click vào bất kỳ mục nào (CVV, hạn dùng, địa chỉ, email, SĐT) để sao chép tức thì.
   - Nút **Sao chép tất cả**: Gom toàn bộ thông tin thanh toán thành một khối văn bản rõ ràng để dán 1 chạm vào các cổng thanh toán.
   - Tự động xóa clipboard sau 30 giây bảo mật.
   - Tìm kiếm thời gian thực theo tên hồ sơ, chủ thẻ, thành phố, zip code.

### 6. Quản lý Cookies & Chuyển đổi phiên tài khoản (Multi-Account Switcher)
1. Mở tab **Cookies**: Tiện ích tự động nhận diện domain của trang web hiện tại (ví dụ: `facebook.com`, `shopee.vn`).
2. **Lưu phiên tài khoản**: Nhấn **+ Lưu phiên** và đặt tên (ví dụ: `Nick 1 - Admin`, `Acc Phụ`), GenPass sẽ chụp toàn bộ cookies hiện tại của domain và lưu trữ cục bộ vào máy.
3. **Chuyển tài khoản (Switch Session)**: Nhấn **Chuyển sang phiên này**, GenPass sẽ tự động nạp cookies tương ứng vào trình duyệt và tải lại trang ngay lập tức.
4. **Xuất / Nhập JSON cookies**:
   - Nhấn **Xuất** để copy toàn bộ JSON cookies hiện tại ra clipboard (chuẩn Cookie-Editor / EditThisCookie).
   - Nhấn **Nhập** để dán danh sách JSON cookies và áp dụng trực tiếp vào trình duyệt.
   - Nhấn **Đăng xuất**: Xóa toàn bộ cookies của trang web hiện tại để thoát tài khoản nhanh chóng.

### 7. Sao lưu và Đồng bộ CSV
1. Tại tab **Lịch sử**, bấm **Xuất** để tải về file CSV theo định dạng phổ biến của các trình quản lý mật khẩu:
   ```csv
   name,url,username,password,note
   ```
2. Bấm **Nhập** để phục hồi dữ liệu từ file CSV sao lưu bên ngoài (tự động loại bỏ mục trùng lặp).

---

## Cấu trúc thư mục dự án

```text
GenPass/
├── manifest.json       # Tệp cấu hình chuẩn Manifest V3 (permissions, background, content scripts)
├── popup.html          # Giao diện chính của tiện ích
├── popup.js            # Điều khiển giao diện, sinh mật khẩu/passphrase, quản lý lịch sử, 2FA
├── popup.css           # Giao diện hiện đại, chế độ sáng/tối tự động
├── background.js       # Service worker chạy ngầm: Context Menus, quét QR, kiểm tra update
├── content.js          # Script nhúng trang web: tự động điền form, badge đăng nhập, lưu mật khẩu
├── content.css         # Định kiểu modal thông báo và badge trên trang web
├── jsqr.js             # Thư viện giải mã QR thuần JS offline (chuẩn CSP)
├── wordlist.js         # Từ điển Diceware EFF chuẩn 1,296 từ cho Passphrase
├── vault.js            # Lõi mã hóa kho: Argon2id -> AES-256-GCM (chỉ chạy ở popup/service worker)
├── vendor/hash-wasm.umd.js  # Thư viện Argon2id WebAssembly (MIT, đóng gói sẵn, chạy offline)
├── tests/              # Kiểm thử crypto + tích hợp popup/service worker (node tests/*.cjs); e2e-chrome.cjs cần Chrome thật
├── icons/              # Biểu tượng tiện ích (16px, 48px, 128px)
├── .gitignore          # Cấu hình bỏ qua tệp hệ thống khi quản lý phiên bản
└── README.md           # Hướng dẫn sử dụng chi tiết
```

---

## Quyền hạn & Cam kết bảo mật

GenPass chỉ yêu cầu các quyền hạn cần thiết tối thiểu theo chuẩn Chrome Extensions:
- `storage`: Lưu trữ danh sách mật khẩu, tài khoản 2FA và cài đặt cá nhân trên máy.
- `clipboardWrite`: Ghi mật khẩu và mã OTP vào bộ nhớ tạm khi người dùng nhấn sao chép.
- `activeTab`: Chụp màn hình và tương tác với các ô nhập liệu trên tab đang mở khi người dùng yêu cầu.
- `contextMenus`: Tạo menu chuột phải tiện lợi.
- `alarms`: Định kỳ kiểm tra cập nhật mới mỗi 12 giờ ở chế độ nền.
- `host_permissions`: Hỗ trợ tải ảnh mã QR cross-origin khi người dùng chọn quét từ menu chuột phải.

**Cam kết**:
- Mã nguồn mở 100%, không chứa mã độc, không chèn quảng cáo, không gắn dịch vụ theo dõi hành vi.
- Toàn bộ dữ liệu mật khẩu và khóa bí mật 2FA đều nằm nguyên vẹn trên thiết bị của bạn.

---

## Bảo mật & mã hóa

### Thuật toán
- Suy diễn khóa bằng Argon2id: `t=3`, `m=64 MiB`, `p=4`, đầu ra 32 byte. Cài đặt WebAssembly từ `hash-wasm` (MIT), đóng gói sẵn trong `vendor/`.
- Mật khẩu, khóa 2FA, thẻ thanh toán và ghi chú được mã hóa AES-256-GCM trong một blob duy nhất (`genVault`) thay vì lưu rời thành nhiều khóa.
- Mỗi lần ghi sinh IV ngẫu nhiên mới, salt 16 byte ngẫu nhiên, auth tag 128 bit. AAD gắn với phiên bản blob để phát hiện thay đổi cấu trúc.

### Mã bảo vệ kho
- Tối thiểu 8 ký tự; nếu chỉ dùng số thì tối thiểu 10 số.
- Có cảnh báo độ mạnh ngay tại ô nhập.

### Tự khóa
- Mặc định khóa khi đóng popup. Service worker phát hiện qua cổng kết nối (`runtime.onConnect`), không dựa vào tác vụ bất đồng bộ của popup vốn bị hủy khi tiến trình popup dừng.
- Tự khóa thêm sau 5, 15 hoặc 30 phút không dùng.
- Khóa phiên nằm trong `chrome.storage.session`, mất khi tắt trình duyệt. Hết hạn phiên, thao tác đọc/ghi trả về trạng thái đã khóa và yêu cầu nhập lại mã.

### Phạm vi bảo mật
- Chống việc lấy cắp file profile hoặc bản sao lưu khi trình duyệt đang tắt.
- KHÔNG chống malware chạy cùng quyền người dùng lúc kho đang mở, và không chống tiện ích mở rộng độc hại khác (có thể đọc `storage.local` đang mở hoặc hook luồng tự động điền).

### Tự động điền
- Chỉ điền khi host của mục đã lưu khớp host của trang đang mở (không tính tiền tố `www.`) và ô nhập đang hiện hình.
- Mã OTP chỉ điền ở top frame, tránh iframe khác origin đọc được mã.

### Ghi đè dữ liệu cũ (LevelDB)
- Khi bật mã hóa, khóa/giá trị dạng văn bản trước đó được ghi đè bằng dữ liệu rác rồi mới xóa để giảm khả năng phục hồi từ ổ đĩa. Biện pháp này giảm rủi ro, không đảm bảo tuyệt đối.

### Ghi chú nâng cấp từ vault v1
- Vault v1 (PBKDF2) chỉ tồn tại trong quá trình phát triển. Blob v1 cũ bị từ chối với lỗi `GPVAULT_BAD_BLOB`. Đây là hành vi có chủ đích: dữ liệu cũ cần mở kho và lưu lại bằng vault v2.

---

## Giấy phép

Mã nguồn được phân phối theo giấy phép [MIT License](LICENSE).

Dự án sử dụng các thành phần bên thứ ba theo đúng điều khoản license của chúng, đầy đủ ghi công trong tệp [NOTICE](NOTICE):

| Thành phần | Tệp | Giấy phép | Chủ sở hữu |
| :--- | :--- | :--- | :--- |
| jsQR 1.4.0 (giải mã QR) | `jsqr.js` | Apache License 2.0 | Lazar Laszlo (cozmo) |
| EFF Diceware short wordlist (từ điển Passphrase) | `wordlist.js` | CC BY (EFF) | Electronic Frontier Foundation |

Tên và thương hiệu của bên thứ ba, bao gồm các từ thương hiệu có trong từ điển EFF, thuộc về chủ sở hữu tương ứng và chỉ được dùng cho mục đích nhận diện/tương thích. GenPass không liên kết hay được bảo chứng bởi các chủ sở hữu đó.
