import { expect, test } from "vitest";
import { translatePattern } from "./ui-patterns-vi.js";

test("lines built from data keep their data and take Vietnamese words", () => {
  const lines: [string, string][] = [
    ["12 min ago", "12 phút trước"],
    [
      'Line 2: "0123" is not a Telegram user id',
      'Dòng 2: "0123" không phải ID người dùng Telegram',
    ],
    [
      "Connected as @office_bot. A message was sent to the chat.",
      "Đã kết nối với tư cách @office_bot. Một tin nhắn đã được gửi vào cuộc trò chuyện.",
    ],
    ["Messages from others ignored: 3", "Tin nhắn từ người khác bị bỏ qua: 3"],
    ["3 h ago", "3 giờ trước"],
    ["2 h 5 min", "2 giờ 5 phút"],
    ["Idle for 45 min", "Rảnh 45 phút"],
    ["Waiting on 2 sub-agents", "Đang chờ 2 subagent"],
    ["Sub-agent of Builder", "Subagent của Builder"],
    ["Context 28%", "Ngữ cảnh 28%"],
    ["All sessions · 8", "Tất cả phiên · 8"],
    ["To do · 3", "Cần làm · 3"],
    ["In progress · 1", "Đang làm · 1"],
    ["Done · 0", "Xong · 0"],
    ["Notes · 2", "Ghi chú · 2"],
    ["Needs you · 1", "Cần bạn · 1"],
    ["Waiting · 4", "Đang chờ · 4"],
    ["Backlog · 3", "Tồn đọng · 3"],
    ["Start task: Build the API", "Bắt đầu việc: Build the API"],
    ["Waiting on p12, p13", "Đang chờ p12, p13"],
    ["After p12, p13", "Sau p12, p13"],
    ["Follow-up: Build the API", "Theo tiếp: Build the API"],
    ["1 needs you", "1 cần bạn"],
    ["2 need you · 1 stalled", "2 cần bạn · 1 bị kẹt"],
    ["Builder is idle", "Builder đang rảnh"],
    ["Builder is at home", "Builder đang ở nhà"],
    ["1 merged", "1 đã gộp"],
    ["1 needs you · 1 stalled · 2 merged", "1 cần bạn · 1 bị kẹt · 2 đã gộp"],
    ["1 stalled · 1 merged", "1 bị kẹt · 1 đã gộp"],
    ["Builder's pull request is merged", "Pull request của Builder đã được gộp"],
    [
      "Builder's pull request is merged: #42 Fix the ledger total",
      "Pull request của Builder đã được gộp: #42 Fix the ledger total",
    ],
    ["3 need you", "3 cần bạn"],
    ["Needs you: Which region?", "Cần bạn: Which region?"],
    ["Builder needs: Which region?", "Builder cần: Which region?"],
    ["3/7 tasks", "3/7 việc"],
    ["2 open · a check failed", "2 đang mở · một kiểm tra lỗi"],
    ["Jira SHOP-12: Checkout fails · 2 more open", "Jira SHOP-12: Checkout fails · 2 đang mở nữa"],
    ["Checkout is stuck in a loop", "Checkout bị kẹt trong vòng lặp"],
    ["Task · claimed by Builder", "Việc · Builder đã nhận"],
    ["Team QA-PR", "Nhóm QA-PR"],
    ["for team QA-PR", "cho nhóm QA-PR"],
    [
      "Hand p12 over to an agent of another provider? Builder loses it, and a note says where it was left.",
      "Giao p12 cho agent của nhà cung cấp khác? Builder sẽ mất việc này, và một ghi chú nói rõ đã dừng ở đâu.",
    ],
    ["not for Codex", "không dành cho Codex"],
    ["1 teammate", "1 thành viên"],
    ["2 teammates", "2 thành viên"],
    ["Replay · 14:05 · 60×", "Xem lại · 14:05 · 60×"],
    ["3 h 20 min at work", "3 giờ 20 phút làm việc"],
    ["1.5 GB free", "1.5 GB trống"],
    ["Put back 1 file", "Đã khôi phục 1 tệp"],
    ["3 changed since the turn", "3 tệp đã thay đổi sau lượt đó"],
    ["1 ignored by git", "1 tệp bị git bỏ qua"],
    [
      "1 left: a folder with other files is in the way",
      "1 tệp bị bỏ lại: một thư mục chứa tệp khác đang chắn đường",
    ],
    ["8 more", "8 nữa"],
    ["13:40 · 5 files", "13:40 · 5 tệp"],
    ["Last read 12:40: 3 imported", "Đọc lần cuối 12:40: đã nhập 3"],
    ["Last read 12:40: nothing new", "Đọc lần cuối 12:40: không có gì mới"],
    ["Open PROJ-12 in Jira", "Mở PROJ-12 trong Jira"],
    ["Open acme/x#4 on GitHub", "Mở acme/x#4 trên GitHub"],
  ];
  for (const [english, vietnamese] of lines) expect(translatePattern(english)).toBe(vietnamese);
});

test("a failure reads in Vietnamese up to the host's own reason", () => {
  expect(translatePattern("Unable to dismiss: The host is offline")).toBe(
    "Không thể bỏ qua: The host is offline",
  );
  expect(translatePattern("Unable to send a test: The webhook answered 403")).toBe(
    "Không thể gửi thử: The webhook answered 403",
  );
  expect(translatePattern("Unable to load the office")).toBe("Không tải được văn phòng");
});

test("a title, a message or a name that only ends like one of the office's lines is left alone", () => {
  for (const said of [
    "Check why the login failed",
    "Fix the platform team",
    "Update the release board",
    "Message queue retries",
    "Who has it",
    "Notes for the payments team",
    "Deploy LoyaPro services to agent s",
  ]) {
    expect(translatePattern(said)).toBe(said);
  }
});

test("the cards' longer lines are in Vietnamese too, with their names and numbers kept", () => {
  const lines: [string, string][] = [
    ["claude does not report its context", "claude không báo cáo ngữ cảnh"],
    ["2 agents left something running", "2 agent để lại thứ gì đó đang chạy"],
    [
      "12 skills on this host, 4 in the teams' workspaces.",
      "12 skill trên host này, 4 trong không gian làm việc của nhóm.",
    ],
    ["Jira connection saved on this host", "Kết nối Jira đã lưu trên host này"],
    ["No Sentry connection on this host", "Chưa có kết nối Sentry trên host này"],
    ["3 open, 1 to review", "3 đang mở, 1 cần xem xét"],
    ["Changes requested on #12", "Yêu cầu thay đổi trên #12"],
    ["Checks fail on #12", "Kiểm tra lỗi trên #12"],
    ["Context 91% full, 182k of 200k tokens", "Ngữ cảnh đầy 91%, 182k trên 200k token"],
    ["Out of Claude", "Hết Claude"],
    [
      "Claude 85% · Codex week: at this pace out by Thu 14:00",
      "Claude 85% · Codex week: theo tốc độ này sẽ hết lúc Thu 14:00",
    ],
    [
      "Claude 5 hours: at this pace out by Thu 14:00",
      "Claude 5 hours: theo tốc độ này sẽ hết lúc Thu 14:00",
    ],
    [
      "Host resources. Plan limit: Claude 5 hours: at this pace out by Thu 14:00",
      "Tài nguyên của host. Giới hạn gói: Claude 5 hours: theo tốc độ này sẽ hết lúc Thu 14:00",
    ],
    ["Starting by itself", "Tự động bắt đầu"],
    [
      "Starting by itself: nothing here is ready to start",
      "Tự động bắt đầu: ở đây chưa có việc nào sẵn sàng bắt đầu",
    ],
    [
      "Starting by itself: waiting, Claude's 5 hours is at 82% (starts under 70%)",
      "Tự động bắt đầu: đang chờ, 5 hours của Claude đã dùng 82% (bắt đầu khi dưới 70%)",
    ],
    [
      "Starting by itself: waiting, 3 tasks are in progress or to do (at most 3)",
      "Tự động bắt đầu: đang chờ, 3 việc đang làm hoặc cần làm (tối đa 3)",
    ],
    [
      "Starting by itself: done for today, 10 started (at most 10 a day)",
      "Tự động bắt đầu: xong cho hôm nay, đã bắt đầu 10 việc (tối đa 10 mỗi ngày)",
    ],
    ["resets in 2 h 5 min", "đặt lại sau 2 giờ 5 phút"],
    ["120 times the clock", "120 lần tốc độ đồng hồ"],
    [
      "3 agents have no desk on this floor. The list shows everyone.",
      "3 agent không có bàn trên tầng này. Danh sách hiển thị tất cả mọi người.",
    ],
    ["Last answer 12 min ago: rain, 14°.", "Câu trả lời gần nhất 12 phút trước: rain, 14°."],
    [
      "The writer could not start: no provider is ready",
      "Người viết không khởi động được: no provider is ready",
    ],
    [
      "Unable to clean up 1 of 3. The first reason: busy",
      "Không dọn được 1 trên 3. Lý do đầu tiên: busy",
    ],
    ["Unable to save the Sound setting: refused", "Không thể lưu cài đặt Âm thanh: refused"],
    ["ended with an error (exit 2)", "kết thúc với lỗi (exit 2)"],
    ["Add SHOP-12 to the lobby board", "Thêm SHOP-12 vào bảng sảnh"],
    ["Duty 2 time", "Giờ trực nhật 2"],
  ];
  for (const [english, vietnamese] of lines) expect(translatePattern(english)).toBe(vietnamese);
});

test("a done task's time and cost line takes the language, its dollar amount as it is", () => {
  const lines: [string, string][] = [
    ["took 23 min · $0.42", "mất 23 phút · $0.42"],
    ["took 1 h 5 min", "mất 1 giờ 5 phút"],
    ["took 2 d", "mất 2 ngày"],
    ["took 1 d 3 h · $12.50", "mất 1 ngày 3 giờ · $12.50"],
    ["took under a minute · under $0.01", "mất dưới một phút · dưới $0.01"],
  ];
  for (const [english, there] of lines) expect(translatePattern(english)).toBe(there);
  // Only the exact line: a post that starts with the word is left alone.
  expect(translatePattern("took the bus to work")).toBe("took the bus to work");
});

test("a meta line joined with · is translated part by part, whatever follows the claim", () => {
  const lines: [string, string][] = [
    [
      "claimed by Planner · for team QA-PR · not for Codex · on Planner's board",
      "Planner đã nhận · cho nhóm QA-PR · không dành cho Codex · trên bảng của Planner",
    ],
    [
      "claimed by Planner · for Planner · for team QA-PR · not for Codex",
      "Planner đã nhận · cho Planner · cho nhóm QA-PR · không dành cho Codex",
    ],
    [
      "Task · claimed by Planner · You → Planner · for team QA-PR · not for Codex · from lobby task p12",
      "Việc · Planner đã nhận · You → Planner · cho nhóm QA-PR · không dành cho Codex · từ việc ở sảnh p12",
    ],
    ["claimed by Planner · not for Codex", "Planner đã nhận · không dành cho Codex"],
  ];
  for (const [english, there] of lines) expect(translatePattern(english)).toBe(there);
});

test("a line with · that is not a meta line is left to the other rules", () => {
  for (const said of [
    "Fix the build · for the demo",
    "for me · not now",
    "Task · fix the build · now",
  ]) {
    expect(translatePattern(said)).toBe(said);
  }
});
