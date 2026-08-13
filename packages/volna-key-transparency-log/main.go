// Copyright 2026 VOLNA contributors
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/transparency-dev/tessera"
	"github.com/transparency-dev/tessera/client"
	"github.com/transparency-dev/tessera/storage/posix"
	"golang.org/x/mod/sumdb/note"
)

const (
	rootTag       = "VOLNA-CHAT-KEY-TRANSPARENCY-ROOT"
	maxEntryBytes = 2048
)

var hashPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

type rootEntry struct {
	Tag                string  `json:"tag"`
	Version            int     `json:"version"`
	Generation         string  `json:"generation"`
	Root               string  `json:"root"`
	PreviousGeneration *string `json:"previousGeneration"`
	PreviousRoot       *string `json:"previousRoot"`
	UpdateCount        int     `json:"updateCount"`
	CreatedAt          string  `json:"createdAt"`
}

type appendResponse struct {
	Index          string   `json:"index"`
	CheckpointNote string   `json:"checkpointNote"`
	TreeSize       string   `json:"treeSize"`
	LogRoot        string   `json:"logRoot"`
	InclusionProof []string `json:"inclusionProof"`
}

type counters struct {
	requests atomic.Uint64
	appends  atomic.Uint64
	failures atomic.Uint64
	active   atomic.Int64
}

func required(name string) string {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		slog.Error("required environment variable is missing", "name", name)
		os.Exit(1)
	}
	return value
}

func canonicalEntry(raw []byte) ([]byte, error) {
	if len(raw) == 0 || len(raw) > maxEntryBytes || bytes.ContainsAny(raw, "\r\n\t") {
		return nil, errors.New("entry size or whitespace is invalid")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var entry rootEntry
	if err := decoder.Decode(&entry); err != nil {
		return nil, fmt.Errorf("decode entry: %w", err)
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return nil, errors.New("entry has trailing data")
	}
	if entry.Tag != rootTag || entry.Version != 1 || !hashPattern.MatchString(entry.Root) {
		return nil, errors.New("entry protocol is invalid")
	}
	generation, err := strconv.ParseUint(entry.Generation, 10, 64)
	if err != nil || generation == 0 || strconv.FormatUint(generation, 10) != entry.Generation {
		return nil, errors.New("entry generation is invalid")
	}
	if (entry.PreviousGeneration == nil) != (entry.PreviousRoot == nil) {
		return nil, errors.New("entry predecessor is invalid")
	}
	if entry.PreviousGeneration != nil {
		previousGeneration, err := strconv.ParseUint(*entry.PreviousGeneration, 10, 64)
		if err != nil || previousGeneration == 0 || previousGeneration >= generation || strconv.FormatUint(previousGeneration, 10) != *entry.PreviousGeneration {
			return nil, errors.New("entry predecessor generation is invalid")
		}
	}
	if entry.PreviousRoot != nil && !hashPattern.MatchString(*entry.PreviousRoot) {
		return nil, errors.New("entry predecessor hash is invalid")
	}
	if entry.UpdateCount < 1 || entry.UpdateCount > 100000 {
		return nil, errors.New("entry update count is invalid")
	}
	createdAt, err := time.Parse("2006-01-02T15:04:05.000Z", entry.CreatedAt)
	if err != nil || createdAt.UTC().Format("2006-01-02T15:04:05.000Z") != entry.CreatedAt {
		return nil, errors.New("entry creation time is invalid")
	}
	canonical, err := json.Marshal(entry)
	if err != nil {
		return nil, err
	}
	if !bytes.Equal(canonical, raw) {
		return nil, errors.New("entry JSON is not canonical")
	}
	return canonical, nil
}

func parseCheckpoint(checkpoint []byte) (uint64, string, error) {
	parts := bytes.SplitN(checkpoint, []byte("\n\n"), 2)
	if len(parts) != 2 {
		return 0, "", errors.New("invalid checkpoint note")
	}
	lines := bytes.Split(parts[0], []byte("\n"))
	if len(lines) != 3 || len(lines[0]) == 0 {
		return 0, "", errors.New("invalid checkpoint body")
	}
	size, err := strconv.ParseUint(string(lines[1]), 10, 64)
	if err != nil || strconv.FormatUint(size, 10) != string(lines[1]) {
		return 0, "", errors.New("invalid checkpoint size")
	}
	root, err := base64.StdEncoding.Strict().DecodeString(string(lines[2]))
	if err != nil || len(root) != sha256.Size {
		return 0, "", errors.New("invalid checkpoint root")
	}
	return size, hex.EncodeToString(root), nil
}

func bearerMatches(request *http.Request, expected string) bool {
	provided := strings.TrimPrefix(request.Header.Get("Authorization"), "Bearer ")
	if len(provided) != len(expected) || len(expected) < 32 {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) == 1
}

func main() {
	storageDir := required("KT_STORAGE_DIR")
	listen := required("KT_LISTEN")
	appendToken := required("KT_APPEND_TOKEN")
	if err := os.MkdirAll(storageDir, 0o700); err != nil {
		slog.Error("create storage directory", "error", err)
		os.Exit(1)
	}
	privateKey := strings.TrimSpace(os.Getenv("KT_LOG_PRIVATE_KEY"))
	if path := strings.TrimSpace(os.Getenv("KT_LOG_PRIVATE_KEY_FILE")); path != "" {
		value, err := os.ReadFile(filepath.Clean(path))
		if err != nil {
			slog.Error("read log signing key", "error", err)
			os.Exit(1)
		}
		privateKey = strings.TrimSpace(string(value))
	}
	signer, err := note.NewSigner(privateKey)
	if err != nil {
		slog.Error("parse log signing key", "error", err)
		os.Exit(1)
	}
	policyRaw := []byte(strings.TrimSpace(os.Getenv("KT_WITNESS_POLICY")))
	if path := strings.TrimSpace(os.Getenv("KT_WITNESS_POLICY_FILE")); path != "" {
		policyRaw, err = os.ReadFile(filepath.Clean(path))
		if err != nil {
			slog.Error("read witness policy", "error", err)
			os.Exit(1)
		}
	}
	production := strings.EqualFold(strings.TrimSpace(os.Getenv("VOLNA_ENV")), "production")
	publicVKey := strings.TrimSpace(os.Getenv("KT_LOG_PUBLIC_VKEY"))
	if production && publicVKey == "" {
		slog.Error("KT_LOG_PUBLIC_VKEY is mandatory in production")
		os.Exit(1)
	}
	if publicVKey != "" {
		verifier, verifierErr := note.NewVerifier(publicVKey)
		if verifierErr != nil || verifier.Name() != signer.Name() || verifier.KeyHash() != signer.KeyHash() {
			slog.Error("public verification key does not match the log signing key")
			os.Exit(1)
		}
	}
	allowUnwitnessed := strings.EqualFold(strings.TrimSpace(os.Getenv("KT_TEST_ONLY_ALLOW_UNWITNESSED")), "true")
	if len(policyRaw) == 0 && (production || !allowUnwitnessed) {
		slog.Error("a real witness policy is mandatory outside explicit non-production tests")
		os.Exit(1)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	driver, err := posix.New(ctx, posix.Config{Path: storageDir})
	if err != nil {
		slog.Error("construct Tessera POSIX storage", "error", err)
		os.Exit(1)
	}
	options := tessera.NewAppendOptions().
		WithCheckpointSigner(signer).
		WithCheckpointInterval(time.Second).
		WithCheckpointRepublishInterval(time.Minute).
		WithBatching(256, time.Second).
		WithPushback(4096)
	if len(policyRaw) > 0 {
		witnesses, err := tessera.NewWitnessGroupFromPolicy(policyRaw)
		if err != nil {
			slog.Error("parse witness policy", "error", err)
			os.Exit(1)
		}
		options.WithWitnesses(witnesses, &tessera.WitnessOptions{Timeout: 8 * time.Second, FailOpen: false})
	}
	appender, shutdown, reader, err := tessera.NewAppender(ctx, driver, options)
	if err != nil {
		slog.Error("start Tessera appender", "error", err)
		os.Exit(1)
	}
	awaiter := tessera.NewPublicationAwaiter(ctx, reader.ReadCheckpoint, 100*time.Millisecond)
	fetcher := client.FileFetcher{Root: storageDir}
	var metrics counters
	concurrency := make(chan struct{}, 32)

	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/map-roots", func(response http.ResponseWriter, request *http.Request) {
		metrics.requests.Add(1)
		if !bearerMatches(request, appendToken) {
			http.Error(response, "unauthorized", http.StatusUnauthorized)
			return
		}
		select {
		case concurrency <- struct{}{}:
			defer func() { <-concurrency }()
		default:
			http.Error(response, "busy", http.StatusServiceUnavailable)
			return
		}
		metrics.active.Add(1)
		defer metrics.active.Add(-1)
		body, err := io.ReadAll(http.MaxBytesReader(response, request.Body, maxEntryBytes))
		if err != nil {
			metrics.failures.Add(1)
			http.Error(response, "invalid body", http.StatusBadRequest)
			return
		}
		entry, err := canonicalEntry(body)
		if err != nil {
			metrics.failures.Add(1)
			http.Error(response, "invalid map root entry", http.StatusBadRequest)
			return
		}
		waitCtx, waitCancel := context.WithTimeout(request.Context(), 15*time.Second)
		defer waitCancel()
		index, checkpoint, err := awaiter.Await(waitCtx, appender.Add(waitCtx, tessera.NewEntry(entry)))
		if err != nil {
			metrics.failures.Add(1)
			http.Error(response, "root was not independently witnessed and published", http.StatusServiceUnavailable)
			return
		}
		treeSize, root, err := parseCheckpoint(checkpoint)
		if err != nil {
			metrics.failures.Add(1)
			http.Error(response, "invalid published checkpoint", http.StatusInternalServerError)
			return
		}
		proofBuilder, err := client.NewProofBuilder(waitCtx, treeSize, fetcher.ReadTile)
		if err != nil {
			metrics.failures.Add(1)
			http.Error(response, "proof builder failed", http.StatusInternalServerError)
			return
		}
		proof, err := proofBuilder.InclusionProof(waitCtx, index.Index)
		if err != nil {
			metrics.failures.Add(1)
			http.Error(response, "inclusion proof failed", http.StatusInternalServerError)
			return
		}
		proofHex := make([]string, len(proof))
		for proofIndex, hash := range proof {
			proofHex[proofIndex] = hex.EncodeToString(hash)
		}
		metrics.appends.Add(1)
		response.Header().Set("Content-Type", "application/json")
		response.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(response).Encode(appendResponse{
			Index: strconv.FormatUint(index.Index, 10), CheckpointNote: string(checkpoint),
			TreeSize: strconv.FormatUint(treeSize, 10), LogRoot: root, InclusionProof: proofHex,
		})
	})
	mux.HandleFunc("GET /health", func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(response, `{"status":"ok"}`)
	})
	mux.HandleFunc("GET /about", func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "text/plain; charset=utf-8")
		response.Header().Set("Cache-Control", "public, max-age=300")
		_, _ = fmt.Fprintf(response,
			"VOLNA Key Transparency log\norigin: %s\nvkey: %s\ncheckpoint: /checkpoint\nsource: https://github.com/rootkovskiy/volna-client/tree/main/packages/volna-key-transparency-log\n",
			signer.Name(), publicVKey)
	})
	mux.HandleFunc("GET /ready", func(response http.ResponseWriter, request *http.Request) {
		if _, err := reader.ReadCheckpoint(request.Context()); err != nil && !errors.Is(err, os.ErrNotExist) {
			http.Error(response, "not ready", http.StatusServiceUnavailable)
			return
		}
		response.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(response, `{"status":"ready"}`)
	})
	mux.HandleFunc("GET /metrics", func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "text/plain; version=0.0.4")
		_, _ = fmt.Fprintf(response,
			"volna_kt_log_requests_total %d\nvolna_kt_log_appends_total %d\nvolna_kt_log_failures_total %d\nvolna_kt_log_active_requests %d\n",
			metrics.requests.Load(), metrics.appends.Load(), metrics.failures.Load(), metrics.active.Load())
	})
	files := http.FileServer(http.Dir(storageDir))
	mux.Handle("GET /checkpoint", cacheControl("no-cache", files))
	mux.Handle("GET /tile/", cacheControl("public, max-age=31536000, immutable", files))
	mux.Handle("GET /entries/", cacheControl("public, max-age=31536000, immutable", files))

	server := &http.Server{
		Addr: listen, Handler: securityHeaders(mux), ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout: 20 * time.Second, WriteTimeout: 20 * time.Second, IdleTimeout: 60 * time.Second,
		MaxHeaderBytes: 16 * 1024,
	}
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-stop
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer shutdownCancel()
		_ = server.Shutdown(shutdownCtx)
		if err := shutdown(shutdownCtx); err != nil {
			slog.Error("Tessera shutdown", "error", err)
		}
		cancel()
	}()
	slog.Info("VOLNA key-transparency log started", "listen", listen, "origin", signer.Name(), "witnessed", len(policyRaw) > 0)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("HTTP server failed", "error", err)
		os.Exit(1)
	}
}

func cacheControl(value string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Cache-Control", value)
		next.ServeHTTP(response, request)
	})
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("X-Content-Type-Options", "nosniff")
		response.Header().Set("Referrer-Policy", "no-referrer")
		response.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		next.ServeHTTP(response, request)
	})
}
