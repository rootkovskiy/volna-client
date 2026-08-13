package main

import (
	"crypto/rand"
	"fmt"
	"os"

	"golang.org/x/mod/sumdb/note"
)

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: keygen <schema-less-log-origin>")
		os.Exit(2)
	}
	privateKey, publicKey, err := note.GenerateKey(rand.Reader, os.Args[1])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	// The first line is secret. Generate this only in the production secret store.
	fmt.Printf("private=%s\nvkey=%s\n", privateKey, publicKey)
}
