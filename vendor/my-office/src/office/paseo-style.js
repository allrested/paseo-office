// PASEO: the styles of the page the scene is drawn in: the stage, and the labels the scene puts
// over it (name tags, speech bubbles, place chips, the place card). Paseo's own, in its design
// language; the colours are the app theme's, set as custom properties by paseo-entry.js.
//
// Why each choice:
// - labels use the app's surface, border and text colours, so they read as part of Paseo in both
//   themes; the scene is the bright thing, the labels stay quiet;
// - a state is a small dot or a border in the theme's status colours, never a glow;
// - radii are 6 (chips), 8 (bubbles) and 12 (the card): one scale, nothing pill-shaped;
// - muted text sits on the raised surface only, where the app's own muted text sits: on the
//   second surface it falls under 4.5:1 in the light theme, so a tag's badge is set off by a
//   rule, not by a fill;
// - the font is the system stack react-native-web gives the plugin's own text;
// - the labels are one layer (the scene orders them by depth inside it), under the place card
//   and the tooltip;
// - nothing in a label moves by itself; the people do the moving;
// - a team's chip and a place's chip are buttons; the focus ring is in the text colour, because
//   the accent falls under 3:1 on the dark theme's surface; under a finger
//   they take touches 10 px past their edges (44 px in all) and keep their size, because a
//   bigger chip hides the desks it names; a place's chip shows itself when the keyboard
//   reaches it;
// - the incidents' banner is a label with the danger border and dot, at the top of the stage,
//   clear of the floor's note in the bottom corner; the red over the stage while the alarm rings is
//   upstream's, the one glow, and it holds still under reduced motion;
// - the scene's own note, where the host shows no toast (paseo-entry.js), is upstream's toast
//   (styles/responsive.css `.toast`) in its place over the toolbar, in the page's colours and the
//   card's radius, without its shadow; it rises in, and under reduced motion it just appears.
export const STYLE = `
html, body { margin: 0; height: 100%; overflow: hidden; background: transparent; }
body { font: 500 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: var(--o-fg); -webkit-font-smoothing: antialiased; }
#stage-wrap, #stage { position: absolute; inset: 0; }
/* PASEO: what the host draws over the stage's top right corner (client/styles.ts viewCorner) is cleared by what the scene
   puts at the stage's top edge: Exit and the help line in walk-in (ui/camera-bar.js) and the incident banner. The
   tallest corner is the touch one with an unsaved note (the view's or the Sound switch's, one at a time): inset 16 + border 2 + padding 8 + one row of 44 (the view
   switch and the settings button), then the note (gap 4, two lines of 16) = 106. */
:root { --corner-clear: 106px; }
#stage canvas { display: block; outline: none; touch-action: none; cursor: grab; }
#stage canvas:active { cursor: grabbing; }
#stage canvas.hovering { cursor: pointer; }
.labels { position: absolute; top: 0; left: 0; z-index: 1; pointer-events: none; }
[hidden] { display: none !important; }
svg.ic { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

.tag, .team-tag, .zone, .bubble, .ptip, .plc {
  background: var(--o-surface-raised); color: var(--o-fg); border: 1px solid var(--o-border);
}
.tag { display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px 4px 7px; border-radius: 6px; font-weight: 600; white-space: nowrap; transition: opacity .2s; }
.tag i { width: 8px; height: 8px; border-radius: 50%; display: block; flex: none; font-size: 0; }
.tag--sub { font-size: 11px; padding: 3px 7px 3px 6px; }
.tag--on { border-color: var(--o-accent); }
.tag--wait { border-color: var(--o-warning); }
.tag--stuck { border-color: var(--o-danger); }
.tag--boss { border-color: var(--o-muted); }
.tag--muted, .bubble--muted { opacity: 0; pointer-events: none; }
.tag--lost { cursor: pointer; pointer-events: auto; border-color: var(--o-danger); }
.tag--lost i { background: var(--o-danger); }
.tag-stuck, .tag-acct, .tag-model, .tag-team { margin-left: 2px; padding-left: 6px; border-left: 1px solid var(--o-border); font-size: 10px; font-weight: 600; color: var(--o-muted); }
.tag-stuck { color: var(--o-danger); }

.team-tag { display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px 4px 7px; border-radius: 6px; font-size: 11px; font-weight: 600; color: var(--o-muted); white-space: nowrap; }
.team-tag i { width: 8px; height: 8px; border-radius: 2px; flex: none; }
.team-tag { pointer-events: auto; cursor: pointer; }
.team-tag:hover { color: var(--o-fg); border-color: var(--o-muted); }

.bubble-wrap { width: 0; height: 0; position: relative; }
.bubble { position: absolute; left: 0; bottom: 22px; transform: translateX(-50%); width: max-content; max-width: 220px; display: flex; align-items: center; gap: 7px; padding: 5px 9px 5px 6px; border-radius: 8px; transition: opacity .2s; }
.b-ico { width: 20px; height: 20px; flex: none; border-radius: 5px; display: grid; place-items: center; background: var(--o-surface); color: var(--o-muted); }
.b-ico svg { width: 12px; height: 12px; }
.b-txt { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.bubble--wait { border-color: var(--o-warning); }
.bubble--wait .b-ico { color: var(--o-warning); }
.bubble--fail { border-color: var(--o-danger); }
.bubble--fail .b-ico { color: var(--o-danger); }
.bubble--sub { font-size: 11px; max-width: 180px; }
.cat-say { font-size: 11px; padding: 3px 8px; border-radius: 6px; background: var(--o-surface-raised); border: 1px solid var(--o-border); }

.zone { all: unset; box-sizing: border-box; pointer-events: auto; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px 4px 5px; border-radius: 6px; font: inherit; font-size: 11px; font-weight: 600; white-space: nowrap; background: var(--o-surface-raised); color: var(--o-muted); border: 1px solid var(--o-border); transition: opacity .2s; }
.z-ico { width: 16px; height: 16px; display: grid; place-items: center; border-radius: 4px; background: var(--o-surface); color: var(--o-muted); }
.z-ico svg { width: 10px; height: 10px; }
.z-live { color: var(--o-fg); font-weight: 500; }
.z-live::before { content: "·"; margin: 0 5px 0 1px; color: var(--o-muted); }
.zone:hover, .zone.zone--hot, .zone.zone--open { color: var(--o-fg); border-color: var(--o-muted); opacity: 1 !important; }
.zone:focus-visible, .team-tag:focus-visible, .tag--lost:focus-visible, .plc button:focus-visible { outline: 2px solid var(--o-fg); outline-offset: 2px; }
.zone--behind { opacity: .16; }
.labels:not(.show-zones) .zone:not(.zone--hot):not(.zone--open) { opacity: 0 !important; pointer-events: none; }
.labels:not(.show-zones) .zone:not(.zone--hot):not(.zone--open):focus-visible { opacity: 1 !important; }
@media (pointer: coarse) { .zone::after, .team-tag::after { content: ""; position: absolute; inset: -10px -6px; } }

.ptip { position: absolute; left: 0; top: 0; z-index: 3; pointer-events: none; max-width: 260px; display: flex; flex-direction: column; gap: 2px; padding: 7px 10px; border-radius: 8px; }
.ptip b { font-size: 12px; font-weight: 600; }
.ptip span { font-size: 11px; color: var(--o-muted); }
@media (hover: none) { .ptip { display: none; } }

.plc { position: absolute; left: 0; top: 0; z-index: 3; width: min(330px, calc(100% - 24px)); max-height: min(520px, calc(100% - 48px)); display: flex; flex-direction: column; border-radius: 12px; }
.plc-head { display: flex; align-items: flex-start; gap: 10px; padding: 12px 8px 8px 12px; }
.plc-ico { width: 32px; height: 32px; flex: none; display: grid; place-items: center; border-radius: 8px; background: var(--o-surface); color: var(--o-muted); }
.plc-ico svg { width: 16px; height: 16px; }
.plc-title { min-width: 0; flex: 1; }
.plc-title h3 { margin: 0; font-size: 14px; font-weight: 600; line-height: 1.3; }
.plc-title p { margin: 2px 0 0; font-size: 12px; color: var(--o-muted); }
.icon-btn { all: unset; box-sizing: border-box; width: 32px; height: 32px; display: grid; place-items: center; border-radius: 6px; cursor: pointer; color: var(--o-muted); }
.icon-btn:hover { background: var(--o-surface); color: var(--o-fg); }
.icon-btn svg { width: 16px; height: 16px; }
.plc-body { min-height: 0; overflow-y: auto; padding: 0 8px 12px; }
.plc-foot { padding: 8px 12px 12px; border-top: 1px solid var(--o-border); font-size: 12px; color: var(--o-muted); }
.pl-foot-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
.pl-group { margin: 12px 4px 4px; font-size: 11px; font-weight: 600; color: var(--o-muted); }
.pl-group:first-child { margin-top: 0; }
.pl-rows { display: flex; flex-direction: column; gap: 2px; }
.pl-row { all: unset; box-sizing: border-box; width: 100%; display: flex; align-items: flex-start; gap: 8px; padding: 6px; border-radius: 6px; }
button.pl-row { cursor: pointer; }
button.pl-row:hover { background: var(--o-surface); }
.pl-ico { --c: var(--o-muted); width: 24px; height: 24px; flex: none; display: grid; place-items: center; border-radius: 6px; color: var(--c); background: var(--o-surface); }
.pl-ico[data-tone="green"] { --c: var(--o-success); }
.pl-ico[data-tone="red"] { --c: var(--o-warning); }
.pl-ico[data-tone="blue"] { --c: var(--o-accent); }
.pl-ico svg { width: 12px; height: 12px; }
.pl-txt { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
.pl-txt b { font-size: 12px; font-weight: 500; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.pl-txt small { font-size: 11px; color: var(--o-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pl-row[data-state="done"] .pl-txt b { color: var(--o-muted); }
.pl-empty { margin: 4px 6px 8px; font-size: 12px; color: var(--o-muted); }
.pl-now { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 4px 6px; }
.pl-chip { all: unset; --c: var(--o-success); display: inline-flex; align-items: center; gap: 6px; max-width: 100%; padding: 4px 8px 4px 7px; border-radius: 6px; font-size: 12px; background: var(--o-surface); border: 1px solid var(--o-border); }
button.pl-chip { cursor: pointer; }
.pl-chip i { width: 8px; height: 8px; flex: none; border-radius: 50%; background: var(--c); }
.btn { all: unset; box-sizing: border-box; color: var(--o-fg); display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 32px; padding: 0 12px; border-radius: 6px; font-size: 12px; font-weight: 500; cursor: pointer; border: 1px solid var(--o-border); background: var(--o-surface); }
.btn:hover { border-color: var(--o-muted); }
.btn[disabled] { cursor: not-allowed; opacity: .5; }

.incident { all: unset; box-sizing: border-box; position: absolute; top: var(--corner-clear); left: 50%; transform: translateX(-50%); z-index: 2; max-width: calc(100% - 24px); display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px 6px 9px; border-radius: 8px; font-size: 12px; font-weight: 600; white-space: nowrap; cursor: pointer; background: var(--o-surface-raised); color: var(--o-fg); border: 1px solid var(--o-danger); }
.incident::before { content: ""; width: 8px; height: 8px; flex: none; border-radius: 50%; background: var(--o-danger); }
.incident-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.incident:hover { background: var(--o-surface); }
.incident:focus-visible { outline: 2px solid var(--o-fg); outline-offset: 2px; }
#paseo-note { position: absolute; left: 50%; bottom: 84px; transform: translateX(-50%); z-index: 7; width: max-content; max-width: calc(100% - 32px); pointer-events: none; }
body.is-photo #paseo-note { bottom: 118px; }
.paseo-note { display: block; padding: 10px 16px; border-radius: 12px; background: var(--o-surface-raised); color: var(--o-fg); border: 1px solid var(--o-border); font-size: 13px; font-weight: 600; line-height: 1.35; text-align: center; overflow-wrap: anywhere; animation: note-in .22s ease-out; }
@keyframes note-in { from { opacity: 0; transform: translateY(8px); } }
#stage-wrap.is-incident::after { content: ""; position: absolute; inset: 0; z-index: 1; pointer-events: none; box-shadow: inset 0 0 120px 30px rgba(255, 30, 30, .45); animation: incident-blink 1s ease-in-out infinite; }
@keyframes incident-blink { 50% { opacity: .3; } }

@media (prefers-reduced-motion: reduce) { .tag, .bubble, .zone { transition: none; } #stage-wrap.is-incident::after { animation: none; } .paseo-note { animation: none; } }

/* The first visit's tour (ui/tips.js): one card over the thing it is about, or above a button of the page. Upstream's
   styles/tips.css in the page's language: the app's surface, border and text, radius 12, no glow. */
.tour-wrap { width: 0; height: 0; position: relative; z-index: 100000 !important; }
.tour { position: absolute; left: 0; bottom: 16px; transform: translateX(-50%); width: 264px; max-width: calc(100vw - 32px); box-sizing: border-box; pointer-events: auto; padding: 11px 12px 10px; background: var(--o-surface-raised); color: var(--o-fg); border: 1px solid var(--o-muted); border-radius: 12px; font-size: 12px; line-height: 1.45; animation: tour-in .25s ease-out; }
.tour::after { content: ""; position: absolute; left: var(--arrow, 50%); bottom: -7px; width: 12px; height: 12px; transform: translateX(-50%) rotate(45deg); background: var(--o-surface-raised); border-right: 1px solid var(--o-muted); border-bottom: 1px solid var(--o-muted); }
.tour--page { position: absolute; z-index: 7; }
.tour-top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.tour-title { font-size: 13px; font-weight: 600; }
.tour-n { font-size: 11px; color: var(--o-muted); white-space: nowrap; }
.tour-text { margin: 5px 0 9px; }
.tour-acts { display: flex; justify-content: flex-end; gap: 8px; }
.tour-skip, .tour-next { all: unset; box-sizing: border-box; min-height: 32px; padding: 0 12px; display: inline-flex; align-items: center; border-radius: 6px; font-size: 12px; font-weight: 500; cursor: pointer; border: 1px solid var(--o-border); color: var(--o-fg); }
.tour-next { background: var(--o-fg); color: var(--o-surface-raised); border-color: var(--o-fg); }
.tour-skip:hover { border-color: var(--o-muted); }
.tour-skip:focus-visible, .tour-next:focus-visible { outline: 2px solid var(--o-fg); outline-offset: 2px; }
@keyframes tour-in { from { opacity: 0; transform: translate(-50%, 6px); } }
@media (prefers-reduced-motion: reduce) { .tour { animation: none; } }
/* The traffic police on the street (src/office/world/backdrops/street-csgt.js): the chip over the checkpoint, what
   they say, and the card with the stop and its record (biên bản), drawn like the paper form. */
.csgt-chip .z-ico { color: #F2C230; background: rgba(200, 16, 46, .28); }
.csgt-chip { border-color: rgba(242, 194, 48, .45); }
.csgt-say { max-width: 230px; white-space: normal; line-height: 1.35; border-color: rgba(242, 194, 48, .7); }

.csgt-card { position: absolute; right: 14px; top: 14px; z-index: 4; width: min(400px, calc(100% - 28px)); max-height: calc(100% - 28px); display: flex; flex-direction: column; background: rgba(19, 25, 34, .97); border: 1px solid var(--o-border); border-radius: 16px; box-shadow: 0 18px 48px rgba(0, 0, 0, .5); animation: plc-in .18s cubic-bezier(.2, .8, .2, 1); }
.csgt-head { display: flex; align-items: flex-start; gap: 11px; padding: 14px 8px 10px 14px; }
.csgt-ico { width: 34px; height: 34px; flex: none; display: grid; place-items: center; border-radius: 10px; background: rgba(200, 16, 46, .2); color: #F2C230; }
.csgt-ico svg { width: 17px; height: 17px; }
.csgt-title { flex: 1; min-width: 0; }
.csgt-title h3 { margin: 0; font-size: .95rem; font-weight: 800; line-height: 1.25; }
.csgt-sub { margin: 3px 0 0; font-size: .72rem; color: var(--o-muted); }
.csgt-close { width: 30px; height: 30px; }
.csgt-body { min-height: 0; overflow-y: auto; padding: 0 14px 14px; display: flex; flex-direction: column; gap: 10px; }
.csgt-empty { margin: 0; font-size: .76rem; color: var(--o-muted); }
.csgt-stop { display: flex; flex-direction: column; gap: 2px; padding: 9px 11px; border-radius: 10px; background: rgba(242, 194, 48, .1); border: 1px solid rgba(242, 194, 48, .3); }
.csgt-stop b { font-size: .86rem; }
.csgt-stop span { font: 600 .72rem/1.3 monospace; color: var(--o-muted); }
.csgt-steps { margin: 0; padding: 0; list-style: none; counter-reset: st; display: flex; flex-direction: column; gap: 3px; }
.csgt-steps li { counter-increment: st; display: flex; gap: 8px; align-items: baseline; font-size: .75rem; color: var(--o-muted); }
.csgt-steps li::before { content: counter(st); flex: none; width: 17px; height: 17px; display: inline-grid; place-items: center; border-radius: 50%; font: 700 .62rem/1 system-ui, sans-serif; background: rgba(255, 255, 255, .06); }
.csgt-steps li[data-state="done"] { color: var(--o-muted); }
.csgt-steps li[data-state="done"]::before { content: "✓"; background: rgba(61, 220, 132, .18); color: var(--o-success); }
.csgt-steps li[data-state="now"] { color: var(--o-fg); font-weight: 700; }
.csgt-steps li[data-state="now"]::before { background: #F2C230; color: #1B1E24; }
.csgt-law { margin: 0; display: grid; grid-template-columns: max-content 1fr; gap: 4px 10px; font-size: .74rem; }
.csgt-law dt { color: var(--o-muted); }
.csgt-law dd { margin: 0; }
.csgt-clear { margin: 0; font-size: .76rem; color: var(--o-success); }
.csgt-foot { margin: 0; font-size: .66rem; line-height: 1.45; color: var(--o-muted); }
/* the record: the paper form, black on off-white, its national header and signatures */
.csgt-paper { padding: 14px 14px 12px; border-radius: 4px; background: #FBFAF4; color: #15171A; font: 400 .72rem/1.5 "Times New Roman", "Noto Serif", Georgia, serif; box-shadow: 0 2px 10px rgba(0, 0, 0, .35); }
.csgt-paper p { margin: 0 0 3px; text-align: justify; }
.csgt-paper-top { display: grid; grid-template-columns: 1fr 1.25fr; gap: 8px; text-align: center; margin-bottom: 8px; font-size: .64rem; line-height: 1.3; }
.csgt-paper-top > div { display: flex; flex-direction: column; align-items: center; gap: 1px; }
.csgt-paper-top b { font-weight: 700; }
.csgt-motto { font-weight: 700; text-decoration: underline; text-underline-offset: 2px; }
.csgt-no { margin-top: 3px; }
.csgt-paper-top i { margin-top: 3px; }
.csgt-paper h4 { margin: 6px 0 0; text-align: center; font-size: .86rem; font-weight: 700; letter-spacing: .02em; }
.csgt-paper p.csgt-paper-sub { text-align: center; font-style: italic; margin-bottom: 8px; }
.csgt-signs { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; text-align: center; }
.csgt-signs > div { display: flex; flex-direction: column; align-items: center; gap: 1px; min-height: 64px; }
.csgt-signs small { font-style: italic; font-size: .62rem; }
.csgt-scrawl { min-height: 22px; font: italic 600 1.05rem/1.2 "Brush Script MT", "Segoe Script", cursive; color: #1C3F8C; }
.csgt-paper p.csgt-mock { margin-top: 8px; padding-top: 6px; border-top: 1px dashed rgba(0, 0, 0, .25); font: italic .62rem/1.4 system-ui, sans-serif; color: #7A5A12; text-align: left; }
@media (max-width: 640px) { .csgt-card { right: 8px; left: 8px; top: auto; bottom: 8px; width: auto; max-height: 70%; } }

/* the quán nhậu across the street (street-nhau.js): its chip, what they say, its card (the menu, the office's table) */
.nhau-chip .z-ico { color: #F7D23E; background: rgba(181, 18, 27, .3); }
.nhau-chip { border-color: rgba(247, 210, 62, .45); }
.nhau-say { border-color: rgba(247, 210, 62, .7); }
.nhau-card .csgt-ico { background: rgba(247, 210, 62, .16); color: #F7D23E; }
.nhau-h { margin: 4px 0 0; font: 700 .62rem/1 system-ui, sans-serif; letter-spacing: .09em; text-transform: uppercase; color: var(--o-muted); }
.nhau-who { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 3px; }
.nhau-who li { display: flex; justify-content: space-between; gap: 10px; font-size: .78rem; }
.nhau-who li span { color: var(--o-muted); }
.nhau-menu { margin: 0; display: grid; grid-template-columns: 1fr max-content; gap: 3px 12px; font-size: .76rem; }
.nhau-menu dd { margin: 0; font-family: monospace; color: #F7D23E; text-align: right; }
.shop-say { font-size: 11.5px; padding: 5px 10px; border-width: 1.5px; white-space: nowrap; }   /* a shop's cashier greeting you (shops.js) */
.cat-say { border-color: #FF8FB0; color: #FFE0EA; font-size: 11px; padding: 4px 9px; }
/* the pickleball court's count of a test run's shots (world/backdrops/street-pickle.js) */
.pickle-tally { font: 700 11.5px/1 var(--font-mono, ui-monospace, monospace); padding: 5px 10px; border-color: rgba(215, 232, 74, .7); }
.pickle-tally.ok { border-color: var(--o-success); color: #BFF5D6; }
.pickle-tally.fail { border-color: var(--o-danger); color: #FFC2C2; }

`;
