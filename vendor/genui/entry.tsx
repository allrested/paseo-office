// The paseo-office entry point for the vendored Generative UI renderer: not upstream's file. It
// names the few things the office's card needs; scripts/build-genui.mjs bundles it.
export { collectLoads, compile, evaluate, initialState } from "./shared/core";
export { RenderNodes } from "./client/render";
export { UiRuntimeContext } from "./client/runtime";
export { composeReply } from "./shared/logic/reply";
