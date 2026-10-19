// The fork requires a selected user before any data root resolves, in the web
// and in core modules that resolve their default root on import. Import this
// first so fixture tests select a fictional user; CAREER_OPS_DATA_DIR still
// names each fixture's data root.
process.env.CAREER_OPS_USER ||= "fixture";
