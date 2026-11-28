import { expect, test } from "vitest";
import { translatePattern } from "./ui-patterns-vi.js";

test("lines built from data keep their data and take Vietnamese words", () => {
  const lines: [string, string][] = [
    ["12 min ago", "12 phút trước"],
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
    ["1 needs you", "1 cần bạn"],
    ["2 need you · 1 stalled", "2 cần bạn · 1 bị kẹt"],
    ["Builder is idle", "Builder đang rảnh"],
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
    ["1 teammate", "1 thành viên"],
    ["2 teammates", "2 thành viên"],
    ["Replay · 14:05 · 60×", "Xem lại · 14:05 · 60×"],
    ["3 h 20 min at work", "3 giờ 20 phút làm việc"],
    ["1.5 GB free", "1.5 GB trống"],
    [
      "Undo the last turn's edits to 3 files?",
      "Hoàn tác các chỉnh sửa của lượt gần nhất trên 3 tệp?",
    ],
    ["1 file restored, 0 skipped", "1 tệp đã khôi phục, 0 bỏ qua"],
    ["2 files changed after the turn", "2 tệp đã thay đổi sau lượt đó"],
    ["1 file left alone, being a link", "1 tệp được giữ nguyên vì là liên kết"],
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
  ];
  for (const [english, vietnamese] of lines) expect(translatePattern(english)).toBe(vietnamese);
});
