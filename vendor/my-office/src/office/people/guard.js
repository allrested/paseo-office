// PASEO: stand-in for my-office's people/guard.js, which Paseo does not take: the guard stands at the street door.
// life/drill.js asks for the guard's post and the marshal; with no street neither is on.
export function updateGuard() {}
export function guardPost() { return null; }
export const marshal = { on: false, at: null, look: null, act: 'walk', yaw: 0, say() {}, hold() {} };
