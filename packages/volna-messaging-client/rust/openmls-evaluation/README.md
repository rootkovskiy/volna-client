# OpenMLS evaluation crate

This crate pins official OpenMLS `0.8.1`, proves a minimal two-device RFC 9420
round trip, and runs a live bidirectional interoperability test against the
public client's pinned `ts-mls` `1.6.2` runtime. The cross-implementation test
passes a real OpenMLS KeyPackage into `ts-mls`, consumes the resulting Welcome
in OpenMLS, then authenticates and decrypts application messages in both
directions with VOLNA routing metadata as MLS AAD. It deliberately
does not expose a production FFI and does not enable OpenMLS `content-debug`,
`crypto-debug`, or test-only dependency features in normal builds.

Passing these tests establishes wire-level interoperability and API/build
feasibility only. It does not establish
safe persistence, native/WASM bindings, device credential validation, recovery,
key transparency, application-level MLS validation, or an independent audit.
