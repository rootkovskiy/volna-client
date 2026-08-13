package main

import (
	"os"
	"testing"

	"github.com/transparency-dev/tessera"
)

func TestCanonicalEntry(t *testing.T) {
	valid := []byte(`{"tag":"VOLNA-CHAT-KEY-TRANSPARENCY-ROOT","version":1,"generation":"7","root":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","previousGeneration":null,"previousRoot":null,"updateCount":3,"createdAt":"2026-08-13T12:00:00.000Z"}`)
	canonical, err := canonicalEntry(valid)
	if err != nil {
		t.Fatalf("valid canonical entry rejected: %v", err)
	}
	if string(canonical) != string(valid) {
		t.Fatalf("canonical entry changed: %s", canonical)
	}
	invalid := [][]byte{
		[]byte(`{"tag":"VOLNA-CHAT-KEY-TRANSPARENCY-ROOT","version":1,"generation":"01","root":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","previousGeneration":null,"previousRoot":null,"updateCount":3,"createdAt":"2026-08-13T12:00:00.000Z"}`),
		[]byte(`{"version":1,"tag":"VOLNA-CHAT-KEY-TRANSPARENCY-ROOT","generation":"1","root":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","previousGeneration":null,"previousRoot":null,"updateCount":3,"createdAt":"2026-08-13T12:00:00.000Z"}`),
		[]byte(`{"tag":"VOLNA-CHAT-KEY-TRANSPARENCY-ROOT","version":1,"generation":"2","root":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","previousGeneration":"2","previousRoot":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","updateCount":3,"createdAt":"2026-08-13T12:00:00.000Z"}`),
	}
	for _, value := range invalid {
		if _, err := canonicalEntry(value); err == nil {
			t.Fatalf("invalid entry accepted: %s", value)
		}
	}
}

func TestProductionWitnessPolicyTemplate(t *testing.T) {
	policy, err := os.ReadFile("witness-policy.production.example")
	if err != nil {
		t.Fatal(err)
	}
	group, err := tessera.NewWitnessGroupFromPolicy(policy)
	if err != nil {
		t.Fatalf("production witness policy is invalid: %v", err)
	}
	if group.N != 2 || len(group.Components) != 3 {
		t.Fatalf("production witness policy is not 2-of-3: N=%d components=%d", group.N, len(group.Components))
	}
}
