# OpenMLS evaluation crate

This crate pins official OpenMLS `0.8.1` and proves a minimal two-device RFC 9420
round trip with VOLNA routing metadata authenticated as MLS AAD. It deliberately
does not expose a production FFI and does not enable OpenMLS `content-debug`,
`crypto-debug`, or test-only dependency features in normal builds.

Passing this test establishes API/build feasibility only. It does not establish
safe persistence, native/WASM bindings, device credential validation, recovery,
key transparency, application-level MLS validation, or an independent audit.
