# Đếm Số — Game nhiều người chơi (real-time)

Game online cho 2–6 người: xếp lục giác, đếm số 1→30 theo chiều kim đồng hồ,
người cuối được đổi 1 số thành từ bất kỳ, ai nhập sai bị loại. Chạy bằng
Node.js + Socket.io (backend) và HTML/CSS/JS thuần (frontend).

## 1. Yêu cầu

- Node.js >= 16 (khuyến nghị 18 hoặc 20). Kiểm tra bằng `node -v`.
- npm (đi kèm Node.js).

## 2. Cài đặt

Mở terminal tại thư mục gốc của project (chứa file `package.json`), chạy:

```bash
npm install
```

Lệnh này sẽ tải về 2 thư viện cần thiết: `express` và `socket.io`.

## 3. Chạy server

```bash
npm start
```

Server sẽ chạy tại `http://localhost:3000` (mặc định). Nếu muốn đổi cổng,
đặt biến môi trường `PORT`, ví dụ:

```bash
PORT=8080 npm start
```

Mở trình duyệt vào địa chỉ trên để chơi. Để nhiều người chơi cùng tham gia
từ các máy khác trong mạng LAN, dùng địa chỉ IP của máy chạy server, ví dụ
`http://192.168.1.10:3000`. Để chơi qua Internet (người chơi ở xa), bạn cần
deploy server này lên một dịch vụ hosting có hỗ trợ Node.js + WebSocket
(Render, Railway, Fly.io, VPS riêng, v.v.) hoặc dùng công cụ tunnel như
ngrok / Cloudflare Tunnel để expose cổng cục bộ ra Internet.

## 4. Cấu trúc project

```
number-game/
├── package.json
├── server/
│   ├── index.js        # Server Express + Socket.io, xử lý toàn bộ event
│   ├── gameLogic.js     # Logic luật chơi: đếm số, đổi từ, loại người chơi
│   └── roomManager.js   # Quản lý phòng: tạo/tìm phòng, slot, host, kick
└── public/
    ├── index.html       # Cấu trúc các màn hình (sảnh chính, tìm phòng, phòng chơi)
    ├── style.css         # Giao diện "sân khấu trong đêm"
    └── app.js            # Toàn bộ logic client: kết nối socket, render UI
```

## 5. Tóm tắt luật chơi đã lập trình

- **Sảnh chính**: nhập tên + chọn avatar có sẵn, nút "Tạo phòng" / "Tìm phòng".
- **Tìm phòng**: nửa trái liệt kê phòng công khai đang mở; nửa phải tìm theo
  mã phòng 6 ký tự (tìm được cả phòng riêng tư).
- **Phòng chờ**: 6 vị trí xếp lục giác, ấn vào ô trống để chuyển tới đó.
  Chủ phòng có nút "✕" để đuổi người chơi, và nút bật/tắt công khai-riêng tư
  ở góc dưới phải. Nút "Bắt đầu" ở giữa, chỉ bật khi có ≥2 người và chỉ
  chủ phòng được bấm.
- **Trong ván chơi**:
  - Random người giữ thẻ "1" đầu tiên khi bắt đầu ván.
  - Đếm 1→30 theo chiều kim đồng hồ; số đã đổi thành từ thì phải nhập đúng từ đó.
  - Nhập sai → bị loại ngay (thành khán giả), người kế tiếp phải nhập lại
    đúng giá trị mà người bị loại vừa nhập sai, rồi mới tiếp tục đếm lên.
  - Người hoàn thành số "30" (bất kể có phải người dự kiến không) được quyền
    đổi 1 trong 30 ô thành từ mới (≤10 ký tự), có 30 giây để đổi.
  - Ô đã từng đổi chỉ được đổi lại khi đã có ≥15 ô bị đổi VÀ đã qua ≥15 lượt
    đổi kể từ lần đổi gần nhất của chính ô đó; không được đổi về giá trị gốc.
  - Thẻ "1" chuyển cho người kế tiếp theo chiều kim đồng hồ sau mỗi vòng.
  - Sân khấu tối lại, người đến lượt được hiệu ứng "đèn sân khấu" sáng quanh
    avatar; có 10 giây để nhập (giảm 1 giây mỗi 15 vòng, tối thiểu 3 giây).
  - Không tới lượt: gõ vào thanh chat sẽ thành tin nhắn thường — trừ khi
    trùng với một từ đã đổi (1-30), tin nhắn đó sẽ bị chặn không hiển thị.
  - Hết ván (còn 1 người) → thông báo người thắng → quay về phòng chờ,
    chủ phòng phải bấm "Bắt đầu" lại cho ván mới.

## 6. Ghi chú kỹ thuật / hạn chế hiện tại

- Dữ liệu phòng/ván chơi lưu hoàn toàn trong RAM của server (không có
  database). Nếu restart server, toàn bộ phòng đang mở sẽ mất — phù hợp
  cho quy mô nhỏ/vừa, nếu cần production-grade với nhiều instance server
  thì cần thêm Redis hoặc một state store dùng chung.
- Mỗi `socket.id` là 1 người chơi; nếu người chơi tải lại trang (refresh),
  họ sẽ mất kết nối cũ và phải vào phòng lại từ đầu (chưa có cơ chế
  reconnect bằng token/session).
- Phần "chờ 30 phút giữa các ván" được xử lý ở server (tự động mở lại lobby
  sau 30 phút) — giao diện hiện thông báo chung, có thể tinh chỉnh thêm để
  hiện đồng hồ đếm ngược chính xác nếu cần.
