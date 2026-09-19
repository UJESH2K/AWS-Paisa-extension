// Build-time settings. apiUrl is the deployed Paisa API (no trailing slash).
// Empty means "no server": the panel offers a labelled sample bill instead.
// This is public configuration. Never put AWS credentials here.
globalThis.PAISA_CONFIG = {
  apiUrl: "",
};
