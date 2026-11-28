import { UI_VI } from "./ui-words-vi.js";

/**
 * The interface's lines that are put together from data, in Vietnamese: an age, a count, a name
 * with a few words around it. Each is the English line's shape and what it becomes; the parts
 * that are data are carried over as they are. Vietnamese has no plural, so a count is the number
 * and a classifier. A line that fits none stays English.
 *
 * A session's title, a chat message and a post are drawn through the same text, so a rule takes a
 * line only by words no title is likely to end in: none here matches "<anything> failed" or
 * "<anything> team".
 */
type Rule = readonly [RegExp, (...parts: string[]) => string];

/** A label as it reads after "Không thể": its Vietnamese, in lower case. */
const lower = (text: string) => {
  const label = translatePattern(`${text.charAt(0).toUpperCase()}${text.slice(1)}`);
  return `${label.charAt(0).toLowerCase()}${label.slice(1)}`;
};

/** A done task's "took 23 min · $0.42": the time through the duration rules, the cost as it is. */
const spent = (time: string, cost: string | undefined) => {
  const days = /^(\d+) d$/.exec(time)?.[1];
  let span = translatePattern(time);
  if (time === "under a minute") span = "dưới một phút";
  if (days !== undefined) span = `${days} ngày`;
  const price = cost === "under $0.01" ? "dưới $0.01" : cost;
  return `mất ${span}${price === undefined ? "" : ` · ${price}`}`;
};

export const RULES: readonly Rule[] = [
  [
    /^Undo the last turn's edits to (\d+) files?\?$/,
    (n) => `Hoàn tác các chỉnh sửa của lượt gần nhất trên ${n} tệp?`,
  ],
  [/^(\d+) files? restored, (\d+) skipped$/, (n, m) => `${n} tệp đã khôi phục, ${m} bỏ qua`],
  [
    /^(\d+) files? (changed after the turn|outside the repository|ignored by git|left alone, being a link|with nothing to put back|that could not be written)$/,
    (n, why) => `${n} tệp ${translatePattern(why)}`,
  ],
  [/^(\d+) min ago$/, (n) => `${n} phút trước`],
  [/^(\d+) h ago$/, (n) => `${n} giờ trước`],
  [/^(\d+) min$/, (n) => `${n} phút`],
  [/^(\d+) h$/, (n) => `${n} giờ`],
  [/^(\d+) h (\d+) min$/, (h, m) => `${h} giờ ${m} phút`],
  [/^(\d+) d (\d+) h$/, (d, h) => `${d} ngày ${h} giờ`],
  [
    /^took (under a minute|\d+ min|\d+ h(?: \d+ min)?|\d+ d(?: \d+ h)?)(?: · (\$\d+\.\d\d|under \$0\.01))?$/,
    spent,
  ],
  [/^Idle for (.+)$/, (time) => `Rảnh ${translatePattern(time)}`],
  [/^Waiting (\d.*)$/, (time) => `Chờ ${translatePattern(time)}`],
  [/^Waiting on (\d+) sub-agents?$/, (n) => `Đang chờ ${n} subagent`],
  [/^Sub-agent of (.+)$/, (name) => `Subagent của ${name}`],
  [/^Context (\d+)%$/, (n) => `Ngữ cảnh ${n}%`],
  [/^context (\d+)%$/, (n) => `ngữ cảnh ${n}%`],
  [/^Fullest context (\d+)%$/, (n) => `Ngữ cảnh đầy nhất ${n}%`],
  [/^(\d+) contexts nearly full$/, (n) => `${n} ngữ cảnh gần đầy`],
  [/^Memory (\d+)%$/, (n) => `Bộ nhớ ${n}%`],
  [/^All sessions · (\d+)$/, (n) => `Tất cả phiên · ${n}`],
  // A kanban column's heading: its title, then how many it holds.
  [
    /^(Backlog|To do|In progress|Needs you|Waiting|Done|Notes) · (\d+)$/,
    (title, n) => `${translatePattern(title)} · ${n}`,
  ],
  [/^(\d+)\/(\d+) tasks$/, (done, all) => `${done}/${all} việc`],
  [/^(\d+) open$/, (n) => `${n} đang mở`],
  [/^(\d+) open · a check failed$/, (n) => `${n} đang mở · một kiểm tra lỗi`],
  [/^(.+) · (\d+) more open$/, (line, n) => `${line} · ${n} đang mở nữa`],
  [/^(\d+) agents?$/, (n) => `${n} agent`],
  [/^(\d+) members$/, (n) => `${n} thành viên`],
  [/^(\d+) lines$/, (n) => `${n} dòng`],
  [/^(\d+) problems$/, (n) => `${n} vấn đề`],
  [/^(\d+) waiting$/, (n) => `${n} đang chờ`],
  [/^(\d+) running$/, (n) => `${n} đang chạy`],
  [/^(\d+) failing$/, (n) => `${n} đang lỗi`],
  [/^(\d+) claimed$/, (n) => `${n} đã nhận`],
  [/^(\d+) to review$/, (n) => `${n} cần xem xét`],
  [/^(\d+) needs? you$/, (n) => `${n} cần bạn`],
  [/^(\d+) stalled$/, (n) => `${n} bị kẹt`],
  [/^(\d+) merged$/, (n) => `${n} đã gộp`],
  [
    /^(\d+ (?:needs? you|stalled|merged)(?: · \d+ (?:stalled|merged))+)$/,
    (parts) => parts.split(" · ").map(translatePattern).join(" · "),
  ],
  [
    /^(.+)'s pull request is merged(?:: (.+))?$/,
    (name, pullRequest) =>
      `Pull request của ${name} đã được gộp${pullRequest === undefined ? "" : `: ${pullRequest}`}`,
  ],
  [/^(\d+) tool steps$/, (n) => `${n} bước dùng công cụ`],
  [/^(\d+) cores?$/, (n) => `${n} nhân`],
  [/^Task · claimed by (.+)$/, (name) => `Việc · ${name} đã nhận`],
  [/^Task · open$/, () => "Việc · đang mở"],
  [/^Task · claimed$/, () => "Việc · đã nhận"],
  [/^Task · done$/, () => "Việc · xong"],
  [/^claimed by (.+)$/, (name) => `${name} đã nhận`],
  [/^Done by (.+)$/, (name) => `Hoàn thành bởi ${name}`],
  [/^(.+) is stuck in a loop$/, (name) => `${name} bị kẹt trong vòng lặp`],
  [/^(.+) stopped on an error$/, (name) => `${name} dừng vì lỗi`],
  [/^(.+) is idle$/, (name) => `${name} đang rảnh`],
  [/^(.+) is at home$/, (name) => `${name} đang ở nhà`],
  [/^(.+) waits for your answer$/, (name) => `${name} chờ câu trả lời của bạn`],
  [/^Needs permission: (.+)$/, (what) => `Cần quyền: ${what}`],
  [/^Replay · (.+)$/, (rest) => `Xem lại · ${rest}`],
  [/^Yesterday (.+)$/, (time) => `Hôm qua ${time}`],
  [/^Today's entry written at (.+)$/, (time) => `Ghi chú hôm nay được viết lúc ${time}`],
  [/^Agent ([0-9a-f]{8})$/, (id) => `Agent ${id}`],
  [/^Delete (\d+) finished to-dos\?$/, (n) => `Xoá ${n} việc đã xong?`],
  [/^Ask (\d+) agents for an update$/, (n) => `Hỏi ${n} agent về tiến độ`],
  [/^Clean up all (\d+)$/, (n) => `Dọn tất cả ${n}`],
  [/^Show (\d+) skills$/, (n) => `Hiện ${n} skill`],
  [/^(.+) is typing…$/, (name) => `${name} đang gõ…`],
  [/^(.+) and (.+) are typing…$/, (a, b) => `${a} và ${b} đang gõ…`],
  [/^(\d+) process(?:es)? · resident memory$/, (n) => `${n} tiến trình · bộ nhớ thường trú`],
  [/^([\d.]+ ?[KMGT]?B) free$/, (size) => `${size} trống`],
  [/^(\d[\d hdmin]*) at work$/, (time) => `${translatePattern(time)} làm việc`],
  [/^(.+) does not report its context$/, (name) => `${name} không báo cáo ngữ cảnh`],
  [
    /^(.+) has no mode "(.+)": the writer starts in (.+)\.$/,
    (provider, mode, used) =>
      `${provider} không có chế độ "${mode}": người viết bắt đầu ở chế độ ${used}.`,
  ],
  [
    /^(.+) writes it and answers on the team's board\.$/,
    (name) => `${name} viết và trả lời trên bảng của nhóm.`,
  ],
  [/^(\d+) agents? left something running$/, (n) => `${n} agent để lại thứ gì đó đang chạy`],
  [
    /^(\d+) skills? on this host, (\d+) in the teams' workspaces\.$/,
    (host, teams) => `${host} skill trên host này, ${teams} trong không gian làm việc của nhóm.`,
  ],
  [/^(\d+) lines, read at (.+)$/, (n, time) => `${n} dòng, đọc lúc ${time}`],
  [/^(.+); sub-agents: (.+)$/, (lead, subs) => `${lead}; subagent: ${subs}`],
  [/^(.+) agents are at a skill now\.$/, (who) => `${who} agent đang dùng skill.`],
  [/^(.+) is at a skill now\.$/, (who) => `${who} đang dùng skill.`],
  [
    /^(.+) connection from the host's environment; a saved one replaces it$/,
    (name) => `Kết nối ${name} từ môi trường của host; kết nối đã lưu sẽ thay thế nó`,
  ],
  [/^(.+) connection saved on this host$/, (name) => `Kết nối ${name} đã lưu trên host này`],
  [/^No (.+) connection on this host$/, (name) => `Chưa có kết nối ${name} trên host này`],
  [/^(\d+) open, none waiting for a review$/, (n) => `${n} đang mở, không có cái nào chờ xem xét`],
  [/^(\d+) open, (\d+) to review$/, (n, m) => `${n} đang mở, ${m} cần xem xét`],
  [/^(.+) has conflicts$/, (ref) => `${ref} có xung đột`],
  [
    /^(.+) is idle and gets the request on the team's board\.$/,
    (name) => `${name} đang rảnh và nhận yêu cầu trên bảng của nhóm.`,
  ],
  [/^(.+): show less$/, (name) => `${name}: thu gọn`],
  [/^(.+): show all of what it is for$/, (name) => `${name}: hiện toàn bộ công dụng`],
  [/^(.+) is still starting\.$/, (name) => `${name} vẫn đang khởi động.`],
  [/^(.+): (.+) in the last 30 minutes$/, (title, range) => `${title}: ${range} trong 30 phút qua`],
  [/^(\d+) people on the floor$/, (n) => `${n} người trên tầng`],
  [/^(\d+) times the clock$/, (n) => `${n} lần tốc độ đồng hồ`],
  [
    /^1 agent has no desk on this floor\. The list shows everyone\.$/,
    () => "1 agent không có bàn trên tầng này. Danh sách hiển thị tất cả mọi người.",
  ],
  [
    /^(\d+) agents have no desk on this floor\. The list shows everyone\.$/,
    (n) => `${n} agent không có bàn trên tầng này. Danh sách hiển thị tất cả mọi người.`,
  ],
  [
    /^1, 5 and 15 min · (\d+) CPUs available to Paseo$/,
    (n) => `1, 5 và 15 phút · ${n} CPU dành cho Paseo`,
  ],
  [
    /^Asked (\d+) agents?\. Each answers on its team's board, and its note shows here\.$/,
    (n) => `Đã hỏi ${n} agent. Mỗi agent trả lời trên bảng của nhóm mình, và ghi chú hiện ở đây.`,
  ],
  [/^Changes requested on (.+)$/, (ref) => `Yêu cầu thay đổi trên ${ref}`],
  [/^Checks fail on (.+)$/, (ref) => `Kiểm tra lỗi trên ${ref}`],
  [/^Context (\d+)% full, (.+)$/, (n, rest) => `Ngữ cảnh đầy ${n}%, ${translatePattern(rest)}`],
  [/^(.+) of (.+) tokens$/, (used, max) => `${used} trên ${max} token`],
  [/^Details read at (.+)$/, (time) => `Chi tiết đọc lúc ${time}`],
  [
    /^Host resources\. Plan limit: (.+)$/,
    (plan) => `Tài nguyên của host. Giới hạn gói: ${translatePattern(plan)}`,
  ],
  [
    /^Last answer (.+): (.+)\.$/,
    (age, what) => `Câu trả lời gần nhất ${translatePattern(age)}: ${what}.`,
  ],
  [/^Log of (.+)$/, (name) => `Log của ${name}`],
  [/^Needs you, (\d+)$/, (n) => `Cần bạn, ${n}`],
  [/^Needs you: ([\s\S]+)$/, (reason) => `Cần bạn: ${reason}`],
  // A blocked task on the Tasks card: its holder, then what it asked for.
  [/^(.+?) needs: ([\s\S]+)$/, (name, reason) => `${name} cần: ${reason}`],
  [
    /^No idle agent, so nobody can be asked, in (.+)\.$/,
    (teams) => `Không có agent nào rảnh, nên chưa hỏi được ai, ở ${teams}.`,
  ],
  [/^No output yet, read at (.+)$/, (time) => `Chưa có kết quả, đọc lúc ${time}`],
  [/^Out of ([A-Z][A-Za-z]+)$/, (name) => `Hết ${name}`],
  [
    /^(.+) · at this pace out by (.+)$/,
    (note, time) => `${translatePattern(note)} · theo tốc độ này sẽ hết lúc ${time}`,
  ],
  [/^Starting by itself: (.+)$/, (why) => `Tự động bắt đầu: ${translatePattern(why)}`],
  [
    /^waiting, (.+)'s (.+) is at (\d+)% \(starts under (\d+)%\)$/,
    (provider, window, used, under) =>
      `đang chờ, ${window} của ${provider} đã dùng ${used}% (bắt đầu khi dưới ${under}%)`,
  ],
  [
    /^waiting, a limit of the plan is too high \(starts under (\d+)%\)$/,
    (under) => `đang chờ, một giới hạn của gói quá cao (bắt đầu khi dưới ${under}%)`,
  ],
  [
    /^waiting, (\d+) tasks? (?:is|are) in progress or to do \(at most (\d+)\)$/,
    (n, most) => `đang chờ, ${n} việc đang làm hoặc cần làm (tối đa ${most})`,
  ],
  [
    /^waiting, enough tasks are in progress or to do \(at most (\d+)\)$/,
    (most) => `đang chờ, đã có đủ việc đang làm hoặc cần làm (tối đa ${most})`,
  ],
  [
    /^done for today, (\d+) started \(at most (\d+) a day\)$/,
    (n, most) => `xong cho hôm nay, đã bắt đầu ${n} việc (tối đa ${most} mỗi ngày)`,
  ],
  [/^resets in (.+)$/, (time) => `đặt lại sau ${translatePattern(time)}`],
  [/^Owed from (.+?)\. (.+)$/, (day, state) => `Còn nợ từ ${day}. ${translatePattern(state)}`],
  [/^The conversation cannot be read: (.+)$/, (why) => `Không đọc được hội thoại: ${why}`],
  [/^The report cannot be read: (.+)$/, (why) => `Không đọc được báo cáo: ${why}`],
  [/^The vault cannot be searched: (.+)$/, (why) => `Không tìm được trong kho: ${why}`],
  [/^The writer could not start: (.+)$/, (why) => `Người viết không khởi động được: ${why}`],
  [
    /^The writer's modes cannot be listed: (.+)$/,
    (why) => `Không liệt kê được các chế độ của người viết: ${why}`,
  ],
  [/^The host has no folder for (.+)\.$/, (teams) => `Host không có thư mục cho ${teams}.`],
  [
    /^The newest (\d+), read at (.+)\. The terminal has (\d+) more above\.$/,
    (n, time, more) => `${n} dòng mới nhất, đọc lúc ${time}. Terminal còn ${more} dòng phía trên.`,
  ],
  [/^This message has (\d+) tasks\.$/, (n) => `Tin nhắn này có ${n} việc.`],
  [
    /^Unable to clean up (\d+) of (\d+)\. The first reason: (.+)$/,
    (failed, all, why) => `Không dọn được ${failed} trên ${all}. Lý do đầu tiên: ${why}`,
  ],
  [/^What a skill of (.+) should teach$/, (team) => `Skill của ${team} nên dạy điều gì`],
  [/^Workspace (.+) · Rename team$/, (name) => `Không gian làm việc ${name} · Đổi tên nhóm`],
  [/^Your answer to (.+)$/, (header) => `Câu trả lời của bạn cho ${header}`],
  [/^ended with an error \(exit (\d+)\)$/, (code) => `kết thúc với lỗi (exit ${code})`],
  [/^from lobby task (.+)$/, (id) => `từ việc ở sảnh ${id}`],
  [/^on (.+)'s board$/, (name) => `trên bảng của ${name}`],
  [/^Team (.+)$/, (name) => `Nhóm ${name}`],
  [/^for team (.+)$/, (name) => `cho nhóm ${name}`],
  [/^(\d+) teammates?$/, (n) => `${n} thành viên`],
  [
    /^(.+) text could not be loaded; the scene is in English$/,
    (language) => `Không tải được văn bản ${language}; cảnh hiển thị bằng tiếng Anh`,
  ],
  [/^The host sent no (.+) text$/, (language) => `Host không gửi văn bản ${language}`],
  [/^Started (.+)$/, (title) => `Đã bắt đầu ${title}`],
  [/^Delete task: (.+)$/, (text) => `Xoá việc: ${text}`],
  [/^Start task: (.+)$/, (text) => `Bắt đầu việc: ${text}`],
  [/^Follow-up: (.+)$/, (text) => `Theo tiếp: ${text}`],
  [/^Waiting on (p\d+(?:, p\d+)*)$/, (ids) => `Đang chờ ${ids}`],
  [/^After (p\d+(?:, p\d+)*)$/, (ids) => `Sau ${ids}`],
  [/^Save the (.+) setting$/, (name) => `Lưu cài đặt ${translatePattern(name)}`],
  [/^Start an agent to analyze (.+)$/, (key) => `Bắt đầu một agent để phân tích ${key}`],
  [/^Add (.+) to the lobby board$/, (key) => `Thêm ${key} vào bảng sảnh`],
  [/^Duty (\d+) time$/, (n) => `Giờ trực nhật ${n}`],
  [
    /^For the 3D view\. Company floor has (\d+) desks, Cozy room (\d+), and Headquarters (\d+)\. Headquarters may draw more slowly on a phone\. Changing it starts the 3D view again\.$/,
    (pro, cozy, hq) =>
      `Cho chế độ xem 3D. Tầng công ty có ${pro} bàn, Phòng ấm cúng ${cozy}, và Trụ sở ${hq}. Trụ sở có thể vẽ chậm hơn trên điện thoại. Thay đổi sẽ khởi động lại chế độ xem 3D.`,
  ],
  [
    /^Your notes on the 3D whiteboard, with ; between them\. Up to (\d+), (\d+) characters each\.$/,
    (most, each) =>
      `Ghi chú của bạn trên bảng trắng 3D, phân tách bằng ;. Tối đa ${most}, mỗi ghi chú ${each} ký tự.`,
  ],
  [
    /^An address that answers in open-meteo's shape, for example (\S+)\. https, or http on the host itself\. The host reads it every 15 minutes while an office is open\.$/,
    (example) =>
      `Địa chỉ trả lời theo định dạng open-meteo, ví dụ ${example}. https, hoặc http trên chính host. Host đọc mỗi 15 phút khi văn phòng đang mở.`,
  ],
  // A failure reads "Unable to <the button>: <why>"; the why is the host's own, as it said it.
  [
    /^Unable to ([^:]+?)(?:: ([\s\S]*))?$/,
    (what, why) => `Không thể ${lower(what)}${why === undefined ? "" : `: ${why}`}`,
  ],
];

/** The line in Vietnamese when a rule fits it, else the line as it is. */
export function translatePattern(text: string): string {
  const known = UI_VI[text];
  if (known !== undefined) return known;
  for (const [shape, write] of RULES) {
    const match = shape.exec(text);
    if (match !== null) return write(...match.slice(1));
  }
  return text;
}
