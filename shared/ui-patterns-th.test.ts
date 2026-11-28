import { expect, test } from "vitest";
import { translatePattern } from "./ui-patterns-th.js";

test("lines built from data keep their data and take Thai words", () => {
  const lines: [string, string][] = [
    ["12 min ago", "12 นาทีที่แล้ว"],
    ["3 h ago", "3 ชั่วโมงที่แล้ว"],
    ["2 h 5 min", "2 ชม. 5 นาที"],
    ["Idle for 45 min", "ว่างมา 45 นาที"],
    ["Waiting on 2 sub-agents", "รอ subagent 2 ตัว"],
    ["Sub-agent of Builder", "subagent ของ Builder"],
    ["Context 28%", "Context 28%"],
    ["3/7 tasks", "3/7 งาน"],
    ["To do · 3", "สิ่งที่ต้องทำ · 3"],
    ["In progress · 1", "กำลังทำ · 1"],
    ["Done · 0", "เสร็จแล้ว · 0"],
    ["Notes · 2", "บันทึก · 2"],
    ["Needs you · 1", "ต้องการคุณ · 1"],
    ["Waiting · 4", "กำลังรอ · 4"],
    ["1 needs you", "ต้องการคุณ 1"],
    ["1 needs you · 2 stalled", "ต้องการคุณ 1 · 2 ค้าง"],
    ["Builder is idle", "Builder ว่างอยู่"],
    ["3 need you", "ต้องการคุณ 3"],
    ["Needs you: Which region?", "ต้องการคุณ: Which region?"],
    ["Builder needs: Which region?", "Builder ต้องการ: Which region?"],
    ["Jira SHOP-12: Checkout fails · 2 more open", "Jira SHOP-12: Checkout fails · เปิดอยู่อีก 2"],
    ["Checkout is stuck in a loop", "Checkout ติดลูป"],
    ["Task · claimed by Builder", "งาน · Builder รับแล้ว"],
    ["Team QA-PR", "ทีม QA-PR"],
    ["for team QA-PR", "สำหรับทีม QA-PR"],
    ["1 teammate", "1 เพื่อนร่วมทีม"],
    ["2 teammates", "2 เพื่อนร่วมทีม"],
    ["3 h 20 min at work", "ทำงานมา 3 ชม. 20 นาที"],
    ["1.5 GB free", "ว่าง 1.5 GB"],
    ["Undo the last turn's edits to 3 files?", "เลิกทำการแก้ไขของรอบล่าสุดใน 3 ไฟล์หรือไม่?"],
    ["1 file restored, 0 skipped", "คืนค่า 1 ไฟล์ ข้าม 0 ไฟล์"],
    ["2 files changed after the turn", "2 ไฟล์ถูกแก้ไขหลังรอบนั้น"],
    ["1 file left alone, being a link", "1 ไฟล์ที่ไม่แตะต้องเพราะเป็นลิงก์"],
  ];
  for (const [english, thai] of lines) expect(translatePattern(english)).toBe(thai);
});

test("a failure reads in Thai up to the host's own reason", () => {
  const dismiss = translatePattern("Dismiss");
  expect(translatePattern("Unable to dismiss: The host is offline")).toBe(
    `ไม่สามารถ${dismiss}: The host is offline`,
  );
  expect(translatePattern("Unable to load the office")).toBe("โหลดออฟฟิศไม่ได้");
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

test("the cards' longer lines are in Thai too, with their names and numbers kept", () => {
  const lines: [string, string][] = [
    ["claude does not report its context", "claude ไม่รายงาน context"],
    ["2 agents left something running", "2 agent ทิ้งงานที่ยังรันอยู่"],
    [
      "12 skills on this host, 4 in the teams' workspaces.",
      "12 skill บน host นี้ 4 อยู่ในพื้นที่ทำงานของทีม",
    ],
    ["Jira connection saved on this host", "บันทึกการเชื่อมต่อ Jira บน host นี้แล้ว"],
    ["No Sentry connection on this host", "ยังไม่มีการเชื่อมต่อ Sentry บน host นี้"],
    ["3 open, 1 to review", "เปิดอยู่ 3 รอตรวจ 1"],
    ["Changes requested on #12", "มีการขอให้แก้ไขใน #12"],
    ["Checks fail on #12", "การตรวจสอบล้มเหลวใน #12"],
    ["Context 91% full, 182k of 200k tokens", "Context เต็ม 91%, 182k จาก 200k token"],
    ["Out of Claude", "Claude หมดแล้ว"],
    ["120 times the clock", "เร็วกว่านาฬิกา 120 เท่า"],
    [
      "3 agents have no desk on this floor. The list shows everyone.",
      "agent 3 ตัวไม่มีโต๊ะบนชั้นนี้ รายการแสดงทุกคน",
    ],
    ["The writer could not start: no provider is ready", "ผู้เขียนเริ่มไม่ได้: no provider is ready"],
    ["Unable to clean up 1 of 3. The first reason: busy", "เคลียร์ไม่ได้ 1 จาก 3 เหตุผลแรก: busy"],
    ["ended with an error (exit 2)", "จบด้วยข้อผิดพลาด (exit 2)"],
    ["Add SHOP-12 to the lobby board", "เพิ่ม SHOP-12 ไปยังบอร์ดล็อบบี้"],
    ["Duty 2 time", "เวลาของเวร 2"],
  ];
  for (const [english, thai] of lines) expect(translatePattern(english)).toBe(thai);
});

test("a done task's time and cost line takes the language, its dollar amount as it is", () => {
  const lines: [string, string][] = [
    ["took 23 min · $0.42", "ใช้เวลา 23 นาที · $0.42"],
    ["took 1 h 5 min", "ใช้เวลา 1 ชม. 5 นาที"],
    ["took 2 d", "ใช้เวลา 2 วัน"],
    ["took 1 d 3 h · $12.50", "ใช้เวลา 1 วัน 3 ชม. · $12.50"],
    ["took under a minute · under $0.01", "ใช้เวลา ไม่ถึงหนึ่งนาที · ต่ำกว่า $0.01"],
  ];
  for (const [english, there] of lines) expect(translatePattern(english)).toBe(there);
  // Only the exact line: a post that starts with the word is left alone.
  expect(translatePattern("took the bus to work")).toBe("took the bus to work");
});
