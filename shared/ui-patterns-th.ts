import { UI_TH } from "./ui-words-th.js";

/**
 * The interface's lines that are put together from data, in Thai: an age, a count, a name
 * with a few words around it. Each is the English line's shape and what it becomes; the parts
 * that are data are carried over as they are. A line that fits none stays English.
 *
 * A session's title, a chat message and a post are drawn through the same text, so a rule takes a
 * line only by words no title is likely to end in: none here matches "<anything> failed" or
 * "<anything> team".
 */
type Rule = readonly [RegExp, (...parts: string[]) => string];

/** A label as it reads after "ไม่สามารถ": its Thai, with a space before a Latin word. */
const label = (text: string) => {
  const thai = translatePattern(`${text.charAt(0).toUpperCase()}${text.slice(1)}`);
  return /^[A-Za-z0-9]/.test(thai) ? ` ${thai}` : thai;
};

/** A done task's "took 23 min · $0.42": the time through the duration rules, the cost as it is. */
const spent = (time: string, cost: string | undefined) => {
  const days = /^(\d+) d$/.exec(time)?.[1];
  let span = translatePattern(time);
  if (time === "under a minute") span = "ไม่ถึงหนึ่งนาที";
  if (days !== undefined) span = `${days} วัน`;
  const price = cost === "under $0.01" ? "ต่ำกว่า $0.01" : cost;
  return `ใช้เวลา ${span}${price === undefined ? "" : ` · ${price}`}`;
};

export const RULES: readonly Rule[] = [
  [
    /^Undo the last turn's edits to (\d+) files?\?$/,
    (n) => `เลิกทำการแก้ไขของรอบล่าสุดใน ${n} ไฟล์หรือไม่?`,
  ],
  [/^(\d+) files? restored, (\d+) skipped$/, (n, m) => `คืนค่า ${n} ไฟล์ ข้าม ${m} ไฟล์`],
  [
    /^(\d+) files? (changed after the turn|outside the repository|ignored by git|left alone, being a link|with nothing to put back|that could not be written)$/,
    (n, why) => `${n} ไฟล์${translatePattern(why)}`,
  ],
  [/^(\d+) min ago$/, (n) => `${n} นาทีที่แล้ว`],
  [/^(\d+) h ago$/, (n) => `${n} ชั่วโมงที่แล้ว`],
  [/^(\d+) min$/, (n) => `${n} นาที`],
  [/^(\d+) h$/, (n) => `${n} ชม.`],
  [/^(\d+) h (\d+) min$/, (h, m) => `${h} ชม. ${m} นาที`],
  [/^(\d+) d (\d+) h$/, (d, h) => `${d} วัน ${h} ชม.`],
  [
    /^took (under a minute|\d+ min|\d+ h(?: \d+ min)?|\d+ d(?: \d+ h)?)(?: · (\$\d+\.\d\d|under \$0\.01))?$/,
    spent,
  ],
  [/^Idle for (.+)$/, (time) => `ว่างมา ${translatePattern(time)}`],
  [/^Waiting (\d.*)$/, (time) => `รอ ${translatePattern(time)}`],
  [/^Waiting on (\d+) sub-agents?$/, (n) => `รอ subagent ${n} ตัว`],
  [/^Sub-agent of (.+)$/, (name) => `subagent ของ ${name}`],
  [/^Context (\d+)%$/, (n) => `Context ${n}%`],
  [/^context (\d+)%$/, (n) => `context ${n}%`],
  [/^Fullest context (\d+)%$/, (n) => `context เต็มที่สุด ${n}%`],
  [/^(\d+) contexts nearly full$/, (n) => `context ใกล้เต็ม ${n} รายการ`],
  [/^Memory (\d+)%$/, (n) => `หน่วยความจำ ${n}%`],
  [/^All sessions · (\d+)$/, (n) => `session ทั้งหมด · ${n}`],
  // A kanban column's heading: its title, then how many it holds.
  [
    /^(To do|In progress|Needs you|Waiting|Done|Notes) · (\d+)$/,
    (title, n) => `${translatePattern(title)} · ${n}`,
  ],
  [/^(\d+)\/(\d+) tasks$/, (done, all) => `${done}/${all} งาน`],
  [/^(\d+) open$/, (n) => `เปิดอยู่ ${n}`],
  [/^(\d+) open · a check failed$/, (n) => `เปิดอยู่ ${n} · การตรวจสอบล้มเหลว 1 รายการ`],
  [/^(.+) · (\d+) more open$/, (line, n) => `${line} · เปิดอยู่อีก ${n}`],
  [/^(\d+) agents?$/, (n) => `${n} agent`],
  [/^(\d+) members$/, (n) => `${n} สมาชิก`],
  [/^(\d+) lines$/, (n) => `${n} บรรทัด`],
  [/^(\d+) problems$/, (n) => `${n} ปัญหา`],
  [/^(\d+) waiting$/, (n) => `รอ ${n}`],
  [/^(\d+) running$/, (n) => `ทำงานอยู่ ${n}`],
  [/^(\d+) failing$/, (n) => `ล้มเหลว ${n}`],
  [/^(\d+) claimed$/, (n) => `รับแล้ว ${n}`],
  [/^(\d+) to review$/, (n) => `รอตรวจ ${n}`],
  [/^(\d+) needs? you$/, (n) => `ต้องการคุณ ${n}`],
  [/^(\d+) stalled$/, (n) => `${n} ค้าง`],
  [
    /^(\d+ needs? you) · (\d+ stalled)$/,
    (blocked, stalled) => `${translatePattern(blocked)} · ${translatePattern(stalled)}`,
  ],
  [/^(\d+) tool steps$/, (n) => `${n} ขั้นตอนของเครื่องมือ`],
  [/^(\d+) cores?$/, (n) => `${n} คอร์`],
  [/^Task · claimed by (.+)$/, (name) => `งาน · ${name} รับแล้ว`],
  [/^Task · open$/, () => "งาน · เปิดอยู่"],
  [/^Task · claimed$/, () => "งาน · รับแล้ว"],
  [/^Task · done$/, () => "งาน · เสร็จแล้ว"],
  [/^claimed by (.+)$/, (name) => `${name} รับแล้ว`],
  [/^Done by (.+)$/, (name) => `${name} ทำเสร็จแล้ว`],
  [/^(.+) is stuck in a loop$/, (name) => `${name} ติดลูป`],
  [/^(.+) stopped on an error$/, (name) => `${name} หยุดเพราะข้อผิดพลาด`],
  [/^(.+) is idle$/, (name) => `${name} ว่างอยู่`],
  [/^(.+) waits for your answer$/, (name) => `${name} รอคำตอบจากคุณ`],
  [/^Needs permission: (.+)$/, (what) => `ต้องได้รับสิทธิ์: ${what}`],
  [/^Replay · (.+)$/, (rest) => `ย้อนหลัง · ${rest}`],
  [/^Yesterday (.+)$/, (time) => `เมื่อวาน ${time}`],
  [/^Today's entry written at (.+)$/, (time) => `บันทึกของวันนี้เขียนเมื่อ ${time}`],
  [/^Agent ([0-9a-f]{8})$/, (id) => `Agent ${id}`],
  [/^Delete (\d+) finished to-dos\?$/, (n) => `ลบรายการที่เสร็จแล้ว ${n} รายการ?`],
  [/^Ask (\d+) agents for an update$/, (n) => `ขอความคืบหน้าจาก ${n} agent`],
  [/^Clean up all (\d+)$/, (n) => `เคลียร์ทั้ง ${n}`],
  [/^Show (\d+) skills$/, (n) => `แสดง ${n} skill`],
  [/^(.+) is typing…$/, (name) => `${name} กำลังพิมพ์…`],
  [/^(.+) and (.+) are typing…$/, (a, b) => `${a} และ ${b} กำลังพิมพ์…`],
  [/^(\d+) process(?:es)? · resident memory$/, (n) => `${n} โพรเซส · หน่วยความจำที่ใช้อยู่`],
  [/^([\d.]+ ?[KMGT]?B) free$/, (size) => `ว่าง ${size}`],
  [/^(\d[\d hdmin]*) at work$/, (time) => `ทำงานมา ${translatePattern(time)}`],
  [/^(.+) does not report its context$/, (name) => `${name} ไม่รายงาน context`],
  [
    /^(.+) has no mode "(.+)": the writer starts in (.+)\.$/,
    (provider, mode, used) => `${provider} ไม่มีโหมด "${mode}": ผู้เขียนเริ่มใน ${used}`,
  ],
  [/^(.+) writes it and answers on the team's board\.$/, (name) => `${name} เขียนและตอบบนบอร์ดของทีม`],
  [/^(\d+) agents? left something running$/, (n) => `${n} agent ทิ้งงานที่ยังรันอยู่`],
  [
    /^(\d+) skills? on this host, (\d+) in the teams' workspaces\.$/,
    (host, teams) => `${host} skill บน host นี้ ${teams} อยู่ในพื้นที่ทำงานของทีม`,
  ],
  [/^(\d+) lines, read at (.+)$/, (n, time) => `${n} บรรทัด อ่านเมื่อ ${time}`],
  [/^(.+); sub-agents: (.+)$/, (lead, subs) => `${lead}; subagent: ${subs}`],
  [/^(.+) agents are at a skill now\.$/, (who) => `${who} agent กำลังใช้ skill`],
  [/^(.+) is at a skill now\.$/, (who) => `${who} กำลังใช้ skill`],
  [
    /^(.+) connection from the host's environment; a saved one replaces it$/,
    (name) => `การเชื่อมต่อ ${name} จาก environment ของ host; ที่บันทึกไว้จะมาแทนที่`,
  ],
  [/^(.+) connection saved on this host$/, (name) => `บันทึกการเชื่อมต่อ ${name} บน host นี้แล้ว`],
  [/^No (.+) connection on this host$/, (name) => `ยังไม่มีการเชื่อมต่อ ${name} บน host นี้`],
  [/^(\d+) open, none waiting for a review$/, (n) => `เปิดอยู่ ${n} ไม่มีรายการที่รอตรวจ`],
  [/^(\d+) open, (\d+) to review$/, (n, m) => `เปิดอยู่ ${n} รอตรวจ ${m}`],
  [/^(.+) has conflicts$/, (ref) => `${ref} มีคอนฟลิกต์`],
  [
    /^(.+) is idle and gets the request on the team's board\.$/,
    (name) => `${name} ว่างอยู่และรับคำขอบนบอร์ดของทีม`,
  ],
  [/^(.+): show less$/, (name) => `${name}: แสดงน้อยลง`],
  [/^(.+): show all of what it is for$/, (name) => `${name}: แสดงทั้งหมดว่าใช้ทำอะไร`],
  [/^(.+) is still starting\.$/, (name) => `${name} ยังเริ่มต้นอยู่`],
  [/^(.+): (.+) in the last 30 minutes$/, (title, range) => `${title}: ${range} ใน 30 นาทีที่ผ่านมา`],
  [/^(\d+) people on the floor$/, (n) => `${n} คนบนชั้น`],
  [/^(\d+) times the clock$/, (n) => `เร็วกว่านาฬิกา ${n} เท่า`],
  [
    /^1 agent has no desk on this floor\. The list shows everyone\.$/,
    () => "agent 1 ตัวไม่มีโต๊ะบนชั้นนี้ รายการแสดงทุกคน",
  ],
  [
    /^(\d+) agents have no desk on this floor\. The list shows everyone\.$/,
    (n) => `agent ${n} ตัวไม่มีโต๊ะบนชั้นนี้ รายการแสดงทุกคน`,
  ],
  [
    /^1, 5 and 15 min · (\d+) CPUs available to Paseo$/,
    (n) => `1, 5 และ 15 นาที · Paseo ใช้ CPU ได้ ${n} ตัว`,
  ],
  [
    /^Asked (\d+) agents?\. Each answers on its team's board, and its note shows here\.$/,
    (n) => `ถาม ${n} agent แล้ว แต่ละตัวตอบบนบอร์ดของทีม และบันทึกของมันจะแสดงที่นี่`,
  ],
  [/^Changes requested on (.+)$/, (ref) => `มีการขอให้แก้ไขใน ${ref}`],
  [/^Checks fail on (.+)$/, (ref) => `การตรวจสอบล้มเหลวใน ${ref}`],
  [/^Context (\d+)% full, (.+)$/, (n, rest) => `Context เต็ม ${n}%, ${translatePattern(rest)}`],
  [/^(.+) of (.+) tokens$/, (used, max) => `${used} จาก ${max} token`],
  [/^Details read at (.+)$/, (time) => `อ่านรายละเอียดเมื่อ ${time}`],
  [
    /^Host resources\. Plan limit: (.+)$/,
    (plan) => `ทรัพยากรของ host ลิมิตของแพลน: ${translatePattern(plan)}`,
  ],
  [/^Last answer (.+): (.+)\.$/, (age, what) => `คำตอบล่าสุด ${translatePattern(age)}: ${what}`],
  [/^Log of (.+)$/, (name) => `Log ของ ${name}`],
  [/^Needs you, (\d+)$/, (n) => `ต้องการคุณ ${n}`],
  [/^Needs you: ([\s\S]+)$/, (reason) => `ต้องการคุณ: ${reason}`],
  // A blocked task on the Tasks card: its holder, then what it asked for.
  [/^(.+?) needs: ([\s\S]+)$/, (name, reason) => `${name} ต้องการ: ${reason}`],
  [
    /^No idle agent, so nobody can be asked, in (.+)\.$/,
    (teams) => `ไม่มี agent ที่ว่าง จึงไม่มีใครให้ถามได้ ใน ${teams}`,
  ],
  [/^No output yet, read at (.+)$/, (time) => `ยังไม่มีเอาต์พุต อ่านเมื่อ ${time}`],
  [/^Out of ([A-Z][A-Za-z]+)$/, (name) => `${name} หมดแล้ว`],
  [/^resets in (.+)$/, (time) => `รีเซ็ตใน ${translatePattern(time)}`],
  [/^Owed from (.+?)\. (.+)$/, (day, state) => `ค้างตั้งแต่ ${day} ${translatePattern(state)}`],
  [/^The conversation cannot be read: (.+)$/, (why) => `อ่านบทสนทนาไม่ได้: ${why}`],
  [/^The report cannot be read: (.+)$/, (why) => `อ่านรายงานไม่ได้: ${why}`],
  [/^The vault cannot be searched: (.+)$/, (why) => `ค้นหาในคลังไม่ได้: ${why}`],
  [/^The writer could not start: (.+)$/, (why) => `ผู้เขียนเริ่มไม่ได้: ${why}`],
  [/^The writer's modes cannot be listed: (.+)$/, (why) => `แสดงรายการโหมดของผู้เขียนไม่ได้: ${why}`],
  [/^The host has no folder for (.+)\.$/, (teams) => `host ไม่มีโฟลเดอร์สำหรับ ${teams}`],
  [
    /^The newest (\d+), read at (.+)\. The terminal has (\d+) more above\.$/,
    (n, time, more) => `ล่าสุด ${n} บรรทัด อ่านเมื่อ ${time} เทอร์มินัลยังมีอีก ${more} บรรทัดด้านบน`,
  ],
  [/^This message has (\d+) tasks\.$/, (n) => `ข้อความนี้มี ${n} งาน`],
  [
    /^Unable to clean up (\d+) of (\d+)\. The first reason: (.+)$/,
    (failed, all, why) => `เคลียร์ไม่ได้ ${failed} จาก ${all} เหตุผลแรก: ${why}`,
  ],
  [/^What a skill of (.+) should teach$/, (team) => `skill ของ ${team} ควรสอนอะไร`],
  [/^Workspace (.+) · Rename team$/, (name) => `พื้นที่ทำงาน ${name} · เปลี่ยนชื่อทีม`],
  [/^Your answer to (.+)$/, (header) => `คำตอบของคุณต่อ ${header}`],
  [/^ended with an error \(exit (\d+)\)$/, (code) => `จบด้วยข้อผิดพลาด (exit ${code})`],
  [/^from lobby task (.+)$/, (id) => `จากงานของล็อบบี้ ${id}`],
  [/^on (.+)'s board$/, (name) => `บนบอร์ดของ ${name}`],
  [/^Team (.+)$/, (name) => `ทีม ${name}`],
  [/^for team (.+)$/, (name) => `สำหรับทีม ${name}`],
  [/^(\d+) teammates?$/, (n) => `${n} เพื่อนร่วมทีม`],
  [
    /^(.+) text could not be loaded; the scene is in English$/,
    (language) => `โหลดข้อความ${language}ไม่ได้ ฉากจึงเป็นภาษาอังกฤษ`,
  ],
  [/^The host sent no (.+) text$/, (language) => `host ไม่ได้ส่งข้อความ${language}`],
  [/^Started (.+)$/, (title) => `เริ่ม ${title}`],
  [/^Delete task: (.+)$/, (text) => `ลบงาน: ${text}`],
  [/^Follow-up: (.+)$/, (text) => `งานต่อเนื่อง: ${text}`],
  [/^Waiting on (p\d+(?:, p\d+)*)$/, (ids) => `รอ ${ids}`],
  [/^After (p\d+(?:, p\d+)*)$/, (ids) => `หลังจาก ${ids}`],
  [/^Save the (.+) setting$/, (name) => `บันทึกการตั้งค่า${label(name)}`],
  [/^Start an agent to analyze (.+)$/, (key) => `เริ่ม agent เพื่อวิเคราะห์ ${key}`],
  [/^Add (.+) to the lobby board$/, (key) => `เพิ่ม ${key} ไปยังบอร์ดล็อบบี้`],
  [/^Duty (\d+) time$/, (n) => `เวลาของเวร ${n}`],
  [
    /^For the 3D view\. Company floor has (\d+) desks, Cozy room (\d+), and Headquarters (\d+)\. Headquarters may draw more slowly on a phone\. Changing it starts the 3D view again\.$/,
    (pro, cozy, hq) =>
      `สำหรับมุมมอง 3D ชั้นบริษัทมี ${pro} โต๊ะ ห้องเล็ก ${cozy} และสำนักงานใหญ่ ${hq} สำนักงานใหญ่อาจวาดช้าลงบนมือถือ การเปลี่ยนค่านี้จะเริ่มมุมมอง 3D ใหม่`,
  ],
  [
    /^Your notes on the 3D whiteboard, with ; between them\. Up to (\d+), (\d+) characters each\.$/,
    (most, each) =>
      `บันทึกของคุณบนไวต์บอร์ด 3D คั่นด้วย ; ได้สูงสุด ${most} รายการ รายการละไม่เกิน ${each} ตัวอักษร`,
  ],
  [
    /^An address that answers in open-meteo's shape, for example (\S+)\. https, or http on the host itself\. The host reads it every 15 minutes while an office is open\.$/,
    (example) =>
      `ที่อยู่ที่ตอบกลับในรูปแบบของ open-meteo เช่น ${example} ใช้ https หรือ http บน host เอง host จะอ่านทุก 15 นาทีขณะที่เปิดออฟฟิศอยู่`,
  ],
  // A failure reads "Unable to <the button>: <why>"; the why is the host's own, as it said it.
  [
    /^Unable to ([^:]+?)(?:: ([\s\S]*))?$/,
    (what, why) => `ไม่สามารถ${label(what)}${why === undefined ? "" : `: ${why}`}`,
  ],
];

/** The line in Thai when a rule fits it, else the line as it is. */
export function translatePattern(text: string): string {
  const known = UI_TH[text];
  if (known !== undefined) return known;
  for (const [shape, write] of RULES) {
    const match = shape.exec(text);
    if (match !== null) return write(...match.slice(1));
  }
  return text;
}
