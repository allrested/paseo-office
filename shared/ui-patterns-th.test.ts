import { expect, test } from "vitest";
import { translatePattern } from "./ui-patterns-th.js";

test("lines built from data keep their data and take Thai words", () => {
  const lines: [string, string][] = [
    ["12 min ago", "12 นาทีที่แล้ว"],
    ['Line 2: "0123" is not a Telegram user id', 'บรรทัด 2: "0123" ไม่ใช่ไอดีผู้ใช้ Telegram'],
    [
      "Connected as @office_bot. A message was sent to the chat.",
      "เชื่อมต่อในชื่อ @office_bot แล้ว ส่งข้อความไปยังแชตแล้ว",
    ],
    ["Messages from others ignored: 3", "ข้อความจากผู้อื่นที่ถูกเมิน: 3"],
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
    ["Backlog · 3", "งานค้าง · 3"],
    ["Start task: Build the API", "เริ่มงาน: Build the API"],
    ["1 needs you", "ต้องการคุณ 1"],
    ["1 needs you · 2 stalled", "ต้องการคุณ 1 · 2 ค้าง"],
    ["Builder is idle", "Builder ว่างอยู่"],
    ["Builder is at home", "Builder อยู่บ้าน"],
    ["1 merged", "1 รวมแล้ว"],
    ["1 needs you · 1 stalled · 2 merged", "ต้องการคุณ 1 · 1 ค้าง · 2 รวมแล้ว"],
    ["1 stalled · 1 merged", "1 ค้าง · 1 รวมแล้ว"],
    ["Builder's pull request is merged", "pull request ของ Builder ถูกรวมแล้ว"],
    [
      "Builder's pull request is merged: #42 Fix the ledger total",
      "pull request ของ Builder ถูกรวมแล้ว: #42 Fix the ledger total",
    ],
    ["Stack: 2 of 3", "สแต็ก: 2 จาก 3"],
    ["4 more lines", "อีก 4 บรรทัด"],
    ["1 more line", "อีก 1 บรรทัด"],
    ["Asked Builder", "ถาม Builder แล้ว"],
    ["3 need you", "ต้องการคุณ 3"],
    ["Needs you: Which region?", "ต้องการคุณ: Which region?"],
    ["Builder needs: Which region?", "Builder ต้องการ: Which region?"],
    ["Jira SHOP-12: Checkout fails · 2 more open", "Jira SHOP-12: Checkout fails · เปิดอยู่อีก 2"],
    ["Checkout is stuck in a loop", "Checkout ติดลูป"],
    ["Task · claimed by Builder", "งาน · Builder รับแล้ว"],
    ["Team QA-PR", "ทีม QA-PR"],
    ["for team QA-PR", "สำหรับทีม QA-PR"],
    [
      "Hand p12 over to an agent of another provider? Builder loses it, and a note says where it was left.",
      "ส่งต่อ p12 ให้เอเจนต์ของผู้ให้บริการรายอื่น? Builder จะเสียงานนี้ไป และโน้ตจะบอกว่าทิ้งไว้ตรงไหน",
    ],
    ["not for Codex", "ไม่ใช่สำหรับ Codex"],
    ["1 teammate", "1 เพื่อนร่วมทีม"],
    ["2 teammates", "2 เพื่อนร่วมทีม"],
    ["3 h 20 min at work", "ทำงานมา 3 ชม. 20 นาที"],
    ["1.5 GB free", "ว่าง 1.5 GB"],
    ["Put back 1 file", "คืนค่า 1 ไฟล์"],
    ["3 changed since the turn", "3 ไฟล์ถูกแก้ไขหลังรอบนั้น"],
    ["1 ignored by git", "1 ไฟล์ที่ git ละเว้น"],
    ["1 left: a folder with other files is in the way", "1 ไฟล์ที่ค้างไว้: มีโฟลเดอร์ที่มีไฟล์อื่นขวางอยู่"],
    ["8 more", "อีก 8"],
    ["13:40 · 5 files", "13:40 · 5 ไฟล์"],
    ["Last read 12:40: 3 imported", "อ่านล่าสุด 12:40: นำเข้า 3"],
    ["Last read 12:40: nothing new", "อ่านล่าสุด 12:40: ไม่มีอะไรใหม่"],
    ["Open PROJ-12 in Jira", "เปิด PROJ-12 ใน Jira"],
    ["Open acme/x#4 on GitHub", "เปิด acme/x#4 บน GitHub"],
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
    [
      "Claude 85% · Codex week: at this pace out by Thu 14:00",
      "Claude 85% · Codex week: ที่ความเร็วนี้จะหมดภายใน Thu 14:00",
    ],
    [
      "Claude 5 hours: at this pace out by Thu 14:00",
      "Claude 5 hours: ที่ความเร็วนี้จะหมดภายใน Thu 14:00",
    ],
    [
      "Host resources. Plan limit: Claude 5 hours: at this pace out by Thu 14:00",
      "ทรัพยากรของ host ลิมิตของแพลน: Claude 5 hours: ที่ความเร็วนี้จะหมดภายใน Thu 14:00",
    ],
    ["Starting by itself", "เริ่มงานเอง"],
    ["Starting by itself: nothing here is ready to start", "เริ่มงานเอง: ที่นี่ยังไม่มีงานที่พร้อมเริ่ม"],
    [
      "Starting by itself: waiting, Claude's 5 hours is at 82% (starts under 70%)",
      "เริ่มงานเอง: รออยู่ 5 hours ของ Claude ใช้ไป 82% (เริ่มเมื่อต่ำกว่า 70%)",
    ],
    [
      "Starting by itself: waiting, 3 tasks are in progress or to do (at most 3)",
      "เริ่มงานเอง: รออยู่ มี 3 งานกำลังทำหรือรอทำ (สูงสุด 3)",
    ],
    [
      "Starting by itself: done for today, 10 started (at most 10 a day)",
      "เริ่มงานเอง: เสร็จสำหรับวันนี้ เริ่มไปแล้ว 10 งาน (สูงสุด 10 ต่อวัน)",
    ],
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

test("a meta line joined with · is translated part by part, whatever follows the claim", () => {
  const lines: [string, string][] = [
    [
      "claimed by Planner · for team QA-PR · not for Codex · on Planner's board",
      "Planner รับแล้ว · สำหรับทีม QA-PR · ไม่ใช่สำหรับ Codex · บนบอร์ดของ Planner",
    ],
    [
      "claimed by Planner · for Planner · for team QA-PR · not for Codex",
      "Planner รับแล้ว · สำหรับ Planner · สำหรับทีม QA-PR · ไม่ใช่สำหรับ Codex",
    ],
    [
      "Task · claimed by Planner · You → Planner · for team QA-PR · not for Codex · from lobby task p12",
      "งาน · Planner รับแล้ว · You → Planner · สำหรับทีม QA-PR · ไม่ใช่สำหรับ Codex · จากงานของล็อบบี้ p12",
    ],
    ["claimed by Planner · not for Codex", "Planner รับแล้ว · ไม่ใช่สำหรับ Codex"],
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
