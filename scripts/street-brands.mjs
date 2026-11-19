// The real names the vendored scene's text carries (every file under vendor/my-office/src/ and
// shared/upstream/, the street's included), and the made-up names they become. This table and its
// tests are the one place a real name is written in this repository: it is the list the check
// refuses.
//
// A name is matched as a whole word (no letter or digit, Vietnamese ones included, right before or
// after it), in the case written here and in all caps, never lower-cased. `followedBy` and
// `notFollowedBy` hold the words after which a name that is also an ordinary word is, or is not,
// the name.
//
// Keys are the identifiers upstream's code uses for a shop, an app, a vehicle or a product. They
// ship as strings and property names, so they are renamed too, and a camelCase compound with them
// (`frostyAsk`). A `quotedOnly` key is also an ordinary word: it is renamed only as a whole quoted
// string or an object key, never as a CSS cursor, and its compounds only where listed here. A
// key with `within` is renamed only inside those exact pieces of text.
export const BRANDS = [
  { real: "Thế Giới Di Động", madeUp: "Handset Hub", keys: [{ from: "tgdd", to: "handset" }] },
  {
    real: "Điện Máy Xanh",
    madeUp: "Copperline Electronics",
    keys: [{ from: "dmx", to: "copperline" }],
  },
  { real: "Bách Hóa Xanh", madeUp: "Green Basket", keys: [{ from: "bhx", to: "basket" }] },
  {
    real: "Highlands Coffee",
    madeUp: "Plateau Coffee",
    keys: [{ from: "highlands", to: "plateau" }],
  },
  // The chain as people say it.
  { real: "Highlands", madeUp: "Plateau" },
  {
    real: "Cộng Cà Phê",
    madeUp: "Olive Cafe",
    keys: [
      { from: "cong", to: "olivecafe", quotedOnly: true },
      { from: "congAsk", to: "olivecafeAsk" },
      { from: "congWeekend", to: "olivecafeWeekend" },
    ],
  },
  // The chain as people say it; not in "Cộng Hòa" (the republic, and a street in Ho Chi Minh City).
  { real: "Cộng", madeUp: "Olive Cafe", notFollowedBy: ["Hòa", "hòa"] },
  {
    real: "Phúc Long",
    madeUp: "Jade Tea House",
    keys: [
      { from: "phuclong", to: "jadetea" },
      { from: "PhucLong", to: "JadeTea" },
    ],
  },
  { real: "Long Châu", madeUp: "Harbor Pharmacy", keys: [{ from: "longchau", to: "harbor" }] },
  { real: "Katinat", madeUp: "Navy Coffee House", keys: [{ from: "katinat", to: "navycafe" }] },
  {
    real: "Circle K",
    madeUp: "Corner Kiosk",
    keys: [
      { from: "circlek", to: "kiosk" },
      { from: "circle-k", to: "kiosk" },
    ],
  },
  { real: "GS25", madeUp: "Pebble Mart", keys: [{ from: "gs25", to: "pebble" }] },
  {
    real: "7-Eleven",
    madeUp: "Daily Stop",
    keys: [
      { from: "seven", to: "dailystop", quotedOnly: true },
      { from: "7-eleven", to: "dailystop" },
    ],
  },
  { real: "Ministop", madeUp: "Hourglass Mart", keys: [{ from: "ministop", to: "hourglass" }] },
  { real: "WinMart+", madeUp: "Greenway Market", keys: [{ from: "winmart", to: "greenway" }] },
  { real: "Mixue", madeUp: "Frosty Cone", keys: [{ from: "mixue", to: "frosty" }] },
  { real: "Phở 24", madeUp: "Phở Ngon" },
  // Phở 24 as the TV's football board writes it (its pixel font has no accents).
  { real: "PHO 24", madeUp: "PHO NGON" },
  { real: "GrabFood", madeUp: "Ridely Food" },
  { real: "GrabBike", madeUp: "Ridely Bike" },
  // Also the verb ("Grab me 500k too"): the name only where the next word is not one of these.
  {
    real: "Grab",
    madeUp: "Ridely",
    notFollowedBy: ["me", "some", "a", "an", "the", "it", "them", "one", "my", "your", "our"],
    keys: [{ from: "grab", to: "ridely", quotedOnly: true }],
  },
  // A second ride app. "Be" is also a word, and "be" a two-letter string (a hex digit pair in
  // three.js), and no rule tells them apart: the name only before "yellow", the key only in the
  // racing game's two pieces of code.
  {
    real: "Be",
    madeUp: "Buzz",
    followedBy: ["yellow"],
    keys: [{ from: "be", to: "buzz", within: ["be: '#F6C51B'", "'box', 'be']"] }],
  },
  {
    real: "Xanh SM",
    madeUp: "Aqua Ride",
    keys: [
      { from: "xsm", to: "aqua" },
      { from: "xanh-sm", to: "aqua" },
    ],
  },
  { real: "V-Green", madeUp: "EcoVolt" },
  {
    real: "VinFast",
    madeUp: "Sorin",
    keys: [
      { from: "vf3", to: "sr3" },
      { from: "vf8", to: "sr8" },
    ],
  },
  { real: "Vietcombank", madeUp: "Lantern Bank" },
  { real: "Shopee", madeUp: "Bazaarly" },
  { real: "Panadol", madeUp: "Kalmora", keys: [{ from: "panadol", to: "kalmora" }] },
  { real: "Hapacol", madeUp: "Feverease", keys: [{ from: "hapacol", to: "feverease" }] },
  { real: "TikTok", madeUp: "ClipClap" },
  // The second character look, named for the film studio's style.
  { real: "Pixar", madeUp: "Cartoon", keys: [{ from: "pixar", to: "cartoon" }] },
  { real: "Toyota", madeUp: "Tokai" },
  { real: "Hyundai", madeUp: "Haneul" },
  { real: "Honda", madeUp: "Hakone" },
  { real: "Mitsubishi", madeUp: "Misaki" },
  // Kia and Ford are matched in this case only: "kia" is a Vietnamese word, "afford" an English one.
  { real: "Kia", madeUp: "Karo" },
  { real: "Ford", madeUp: "Forge" },
  { real: "Vios", madeUp: "Velo" },
  { real: "Fortuner", madeUp: "Forterra" },
  { real: "Xpander", madeUp: "Xplora" },
];

/**
 * Exact text rewritten whole before the names are swapped, where a made-up name would read oddly.
 * Matched as whole words, like a name.
 */
export const PHRASES = [
  { from: "vertical 9:16 for Reels, TikTok and Shorts", to: "vertical 9:16 for short-video apps" },
  { from: "a Mixue cone", to: "a Frosty Cone soft-serve" },
  { from: "a Cộng coffee", to: "an Olive Cafe coffee" },
  { from: "a Cộng coconut coffee", to: "an Olive Cafe coconut coffee" },
  // (comments in the clip's file name a video app's features; the first sentence runs over two lines)
  { from: "(1080 × 1920) for Reels, TikTok", to: "(1080 × 1920) for short-video" },
  { from: "and Shorts, the camera turning", to: "apps, the camera turning" },
  { from: "(Reels: about the top 14%", to: "(about the top 14%" },
];

/** Every real name, in table order. `leftIn` reports these. */
export const REAL_NAMES = BRANDS.map((brand) => brand.real);
