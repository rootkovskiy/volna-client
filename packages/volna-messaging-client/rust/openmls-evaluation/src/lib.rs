#![forbid(unsafe_code)]

/// The exact OpenMLS release evaluated by this crate.
pub const OPENMLS_VERSION: &str = "0.8.1";

/// VOLNA's evaluated RFC 9420 mandatory-to-implement ciphersuite.
pub const CIPHERSUITE_NAME: &str =
    "MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519";

#[cfg(test)]
mod tests {
    use openmls::{
        credentials::{BasicCredential, CredentialWithKey},
        framing::{MlsMessageBodyIn, MlsMessageIn, ProcessedMessageContent},
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
}
