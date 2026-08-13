#![forbid(unsafe_code)]

/// The exact OpenMLS release evaluated by this crate.
pub const OPENMLS_VERSION: &str = "0.8.1";

/// VOLNA's evaluated RFC 9420 mandatory-to-implement ciphersuite.
pub const CIPHERSUITE_NAME: &str =
    "MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519";

#[cfg(test)]
mod tests {
    use std::{
        io::{BufRead, BufReader, Write},
        path::PathBuf,
        process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    };

    use openmls::{
        credentials::{BasicCredential, CredentialWithKey},
        framing::{MlsMessageBodyIn, MlsMessageIn, MlsMessageOut, ProcessedMessageContent},
        group::{GroupId, MlsGroup, MlsGroupJoinConfig, StagedWelcome},
        prelude::{Ciphersuite, SignatureScheme},
    };
    use openmls_basic_credential::SignatureKeyPair;
    use openmls_rust_crypto::OpenMlsRustCrypto;
    use openmls_traits::OpenMlsProvider;
    use tls_codec::{Deserialize, Serialize};

    const CIPHERSUITE: Ciphersuite =
        Ciphersuite::MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519;

    struct TestDevice {
        provider: OpenMlsRustCrypto,
        credential: CredentialWithKey,
        signer: SignatureKeyPair,
    }

    impl TestDevice {
        fn new(identity: &[u8]) -> Self {
            let provider = OpenMlsRustCrypto::default();
            let signer = SignatureKeyPair::new(SignatureScheme::ED25519)
                .expect("test device signature key must be generated");
            signer
                .store(provider.storage())
                .expect("test device signature key must be persisted");
            let credential = CredentialWithKey {
                credential: BasicCredential::new(identity.to_vec()).into(),
                signature_key: signer.public().into(),
            };
            Self {
                provider,
                credential,
                signer,
            }
        }
    }

    struct TsMlsPeer {
        child: Child,
        input: ChildStdin,
        output: BufReader<ChildStdout>,
    }

    impl TsMlsPeer {
        fn spawn() -> Self {
            let script = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../test/openmls-interop-peer.mjs");
            let node = std::env::var("VOLNA_NODE_BINARY").unwrap_or_else(|_| "node".to_owned());
            let mut child = Command::new(node)
                .arg("--experimental-global-webcrypto")
                .arg(script)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::inherit())
                .spawn()
                .expect("the pinned ts-mls interop peer must start");
            let input = child.stdin.take().expect("interop stdin must be piped");
            let output = BufReader::new(child.stdout.take().expect("interop stdout must be piped"));
            Self {
                child,
                input,
                output,
            }
        }

        fn exchange(&mut self, command: &str) -> Vec<String> {
            writeln!(self.input, "{command}").expect("interop command must be written");
            self.input.flush().expect("interop command must be flushed");
            let mut response = String::new();
            self.output
                .read_line(&mut response)
                .expect("interop response must be readable");
            assert!(!response.is_empty(), "ts-mls peer exited before responding");
            response
                .trim_end_matches(['\r', '\n'])
                .split('|')
                .map(str::to_owned)
                .collect()
        }
    }

    impl Drop for TsMlsPeer {
        fn drop(&mut self) {
            let _ = self.input.flush();
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }

    fn encode_hex(bytes: &[u8]) -> String {
        const ALPHABET: &[u8; 16] = b"0123456789abcdef";
        let mut output = String::with_capacity(bytes.len() * 2);
        for byte in bytes {
            output.push(ALPHABET[(byte >> 4) as usize] as char);
            output.push(ALPHABET[(byte & 0x0f) as usize] as char);
        }
        output
    }

    fn decode_hex(value: &str) -> Vec<u8> {
        assert!(!value.is_empty() && value.len() % 2 == 0, "invalid interop hex length");
        value
            .as_bytes()
            .chunks_exact(2)
            .map(|pair| {
                let digit = |value: u8| match value {
                    b'0'..=b'9' => value - b'0',
                    b'a'..=b'f' => value - b'a' + 10,
                    _ => panic!("invalid lowercase interop hex"),
                };
                (digit(pair[0]) << 4) | digit(pair[1])
            })
            .collect()
    }

    #[test]
    fn official_openmls_round_trip_authenticates_volna_aad() {
        let alice = TestDevice::new(b"account_alice/device_1");
        let bob = TestDevice::new(b"account_bob/device_1");

        let bob_key_package = openmls::key_packages::KeyPackage::builder()
            .build(
                CIPHERSUITE,
                &bob.provider,
                &bob.signer,
                bob.credential.clone(),
            )
            .expect("Bob key package must be built");

        let mut alice_group = MlsGroup::builder()
            .ciphersuite(CIPHERSUITE)
            .with_group_id(GroupId::from_slice(b"thread_12345678"))
            .build(
                &alice.provider,
                &alice.signer,
                alice.credential.clone(),
            )
            .expect("Alice group must be created");

        let (_commit, welcome, _group_info) = alice_group
            .add_members(
                &alice.provider,
                &alice.signer,
                &[bob_key_package.key_package().clone()],
            )
            .expect("Bob must be added");
        alice_group
            .merge_pending_commit(&alice.provider)
            .expect("Alice must merge the add commit");

        let welcome_bytes = welcome
            .tls_serialize_detached()
            .expect("welcome message must serialize");
        let welcome = match MlsMessageIn::tls_deserialize_exact(welcome_bytes)
            .expect("welcome message must deserialize")
            .extract()
        {
            MlsMessageBodyIn::Welcome(welcome) => welcome,
            _ => panic!("expected a Welcome message"),
        };
        let ratchet_tree = alice_group.export_ratchet_tree().into();
        let join_config = MlsGroupJoinConfig::builder().build();
        let mut bob_group = StagedWelcome::new_from_welcome(
            &bob.provider,
            &join_config,
            welcome,
            Some(ratchet_tree),
        )
        .expect("Bob must process Welcome")
        .into_group(&bob.provider)
        .expect("Bob group must be persisted");

        let aad = br#"["VOLNA-CHAT-AAD",1,"thread_12345678","account_alice","device_12345678","envelope_12345678","APPLICATION","1"]"#;
        let plaintext = br#"{"v":1,"kind":"message.create","logicalMessageId":"logical_12345678","clientCreatedAt":"2026-08-03T00:00:00.000Z","text":"hello"}"#;
        alice_group.set_aad(aad.to_vec());
        let encrypted = alice_group
            .create_message(&alice.provider, &alice.signer, plaintext)
            .expect("application message must encrypt")
            .tls_serialize_detached()
            .expect("application message must serialize");

        let incoming = MlsMessageIn::tls_deserialize_exact(encrypted)
            .expect("application message must deserialize");
        let private_message = match incoming.extract() {
            MlsMessageBodyIn::PrivateMessage(message) => message,
            _ => panic!("expected a private MLS message"),
        };
        let processed = bob_group
            .process_message(&bob.provider, private_message)
            .expect("Bob must authenticate and decrypt the application message");
        assert_eq!(processed.aad(), aad);
        match processed.into_content() {
            ProcessedMessageContent::ApplicationMessage(message) => {
                assert_eq!(message.into_bytes(), plaintext);
            }
            _ => panic!("expected application content"),
        }
    }

    #[test]
    fn ts_mls_and_openmls_exchange_real_welcome_and_application_messages() {
        let provider = OpenMlsRustCrypto::default();
        let signer = SignatureKeyPair::new(SignatureScheme::ED25519)
            .expect("OpenMLS interop signer must be generated");
        signer
            .store(provider.storage())
            .expect("OpenMLS interop signer must be persisted");
        let mut peer = TsMlsPeer::spawn();

        let credential_response = peer.exchange(&format!("IDENTITY|{}", encode_hex(signer.public())));
        assert_eq!(credential_response.first().map(String::as_str), Some("CREDENTIAL"));
        assert_eq!(credential_response.len(), 2);
        let credential = CredentialWithKey {
            credential: BasicCredential::new(decode_hex(&credential_response[1])).into(),
            signature_key: signer.public().into(),
        };
        let key_package = openmls::key_packages::KeyPackage::builder()
            .build(CIPHERSUITE, &provider, &signer, credential)
            .expect("OpenMLS interop key package must be built");
        let key_package_message = MlsMessageOut::from(key_package.key_package().clone())
            .tls_serialize_detached()
            .expect("OpenMLS key package must serialize as an MLSMessage");

        let welcome_response = peer.exchange(&format!(
            "KEY_PACKAGE|{}",
            encode_hex(&key_package_message),
        ));
        assert_eq!(welcome_response.first().map(String::as_str), Some("WELCOME"));
        assert_eq!(welcome_response.len(), 3);
        let expected_group_id = decode_hex(&welcome_response[1]);
        let welcome = match MlsMessageIn::tls_deserialize_exact(decode_hex(&welcome_response[2]))
            .expect("ts-mls Welcome must deserialize in OpenMLS")
            .extract()
        {
            MlsMessageBodyIn::Welcome(welcome) => welcome,
            _ => panic!("expected a ts-mls Welcome message"),
        };
        let mut group = StagedWelcome::new_from_welcome(
            &provider,
            &MlsGroupJoinConfig::builder().use_ratchet_tree_extension(true).build(),
            welcome,
            None,
        )
        .expect("OpenMLS must process the ts-mls Welcome and embedded ratchet tree")
        .into_group(&provider)
        .expect("OpenMLS interop group must be persisted");
        assert_eq!(group.group_id().as_slice(), expected_group_id);
        assert_eq!(group.epoch().as_u64(), 1);

        let bob_aad = br#"["VOLNA-CHAT-AAD",1,"thread_interop_1","account_openmls_bob","device_openmls_bob","envelope_openmls_1","APPLICATION","1",null,null]"#;
        let bob_plaintext = br#"{"v":1,"kind":"message.create","logicalMessageId":"logical_openmls_1","clientCreatedAt":"2026-08-13T12:00:00.000Z","text":"hello from OpenMLS"}"#;
        group.set_aad(bob_aad.to_vec());
        let openmls_message = group
            .create_message(&provider, &signer, bob_plaintext)
            .expect("OpenMLS interop application message must encrypt")
            .tls_serialize_detached()
            .expect("OpenMLS interop application message must serialize");
        let reply = peer.exchange(&format!("OPENMLS_MESSAGE|{}", encode_hex(&openmls_message)));
        assert_eq!(reply.first().map(String::as_str), Some("TSMLS_MESSAGE"));
        assert_eq!(reply.len(), 2);

        let alice_aad = br#"["VOLNA-CHAT-AAD",1,"thread_interop_1","account_tsmls_alice","device_tsmls_alice","envelope_tsmls_1","APPLICATION","1",null,null]"#;
        let incoming = MlsMessageIn::tls_deserialize_exact(decode_hex(&reply[1]))
            .expect("ts-mls private message must deserialize in OpenMLS");
        let private_message = match incoming.extract() {
            MlsMessageBodyIn::PrivateMessage(message) => message,
            _ => panic!("expected a ts-mls private MLS message"),
        };
        let processed = group
            .process_message(&provider, private_message)
            .expect("OpenMLS must authenticate and decrypt the ts-mls message");
        assert_eq!(processed.aad(), alice_aad);
        match processed.into_content() {
            ProcessedMessageContent::ApplicationMessage(message) => {
                assert_eq!(
                    message.into_bytes(),
                    br#"{"v":1,"kind":"message.create","logicalMessageId":"logical_tsmls_reply_1","clientCreatedAt":"2026-08-13T12:00:01.000Z","text":"hello from ts-mls"}"#,
                );
            }
            _ => panic!("expected ts-mls application content"),
        }
    }
}
