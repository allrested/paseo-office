// PASEO: the plain signs of the street. Upstream loads the chains' real logos from image files; Paseo ships none, so
// the file names the street asks for (see shops.js's CHAINS and street-life.js's decals) are drawn here as the made-up
// name in plain bold letters. A canvas stands in for the image: callers read naturalWidth, naturalHeight and draw it.
export const SIGNS = {
  'frosty.svg': { text: 'Frosty Cone', ink: '#E50914' },
  'olivecafe.svg': { text: 'Olive Cafe', ink: '#4E5E2B' },
  'copperline.svg': { text: 'Copperline Electronics', ink: '#005C7A' },
  'harbor.svg': { text: 'Harbor Pharmacy', ink: '#1554D1' },
  'jadetea.svg': { text: 'Jade Tea House', ink: '#006F3C' },
  'navycafe.svg': { text: 'Navy Coffee House', ink: '#BF9369' },
  'handset.svg': { text: 'Handset Hub', ink: '#5C4900' },
  'plateau.svg': { text: 'Plateau Coffee', ink: '#9B1C21' },
  'kiosk.svg': { text: 'Corner Kiosk', ink: '#E21F26' },
  'pebble.svg': { text: 'Pebble Mart', ink: '#0068B7' },
  'dailystop.svg': { text: 'Daily Stop', ink: '#008163' },
  'hourglass.svg': { text: 'Hourglass Mart', ink: '#003894' },
  'greenway.png': { text: 'Greenway', ink: '#E21B2A' },
  'basket.png': { text: 'Green Basket', ink: '#008C44' },
  'aqua.svg': { text: 'Aqua Ride', ink: '#22B8BE' },
  'ridely.svg': { text: 'Ridely', ink: '#00B14F' },
};
const made = new Map();
/** The sign for a file name the street asks for: a canvas 4:1, the name centred in bold capitals. */
export function signImage(file) {
  if (made.has(file)) return made.get(file);
  const { text = '', ink = '#333333' } = SIGNS[file] || {};
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  if (file !== 'aqua.svg' && file !== 'ridely.svg') { g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, c.width, c.height); }
  g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle';
  let size = 84;
  g.font = `900 ${size}px system-ui, sans-serif`;
  while (size > 24 && g.measureText(text).width > 480) { size -= 4; g.font = `900 ${size}px system-ui, sans-serif`; }
  g.fillText(text, 256, 66);
  c.complete = true; c.naturalWidth = c.width; c.naturalHeight = c.height;
  made.set(file, c);
  return c;
}
