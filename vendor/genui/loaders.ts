// Not upstream's file: stands in for upstream's client/loaders.ts, which reads files, searches
// the web and asks the daemon through the Generative UI plugin's own RPCs. The office has none of
// those, so each loader reports it is not available. The office replaces the components that call
// them with a labelled placeholder before they draw (shared/genui-placeholders.ts); these answers
// are only what a component would see if one were drawn.
const OFF = { ok: false, off: true, error: "Needs the Generative UI plugin's workspace chat." } as const;
const off = () => Promise.resolve(OFF);

export const useImageSearch = () => null;
export const useGeocodePlace = () => off;
export const useMapTileLoader = () => off;
export const useProjectRpc = () => ({
  changes: off,
  patches: off,
  commits: off,
  pullRequest: off,
  threads: off,
  environments: off,
  environment: off,
});
