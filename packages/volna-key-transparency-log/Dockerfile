FROM golang:1.26.8-bookworm@sha256:9fdc884aacc3bec89b20ffc69f4bb369c78210e3e4f600387b5128b12c199f81 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download && go mod verify
COPY main.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -buildvcs=false -ldflags="-s -w" -o /out/volna-key-transparency-log .

FROM gcr.io/distroless/static-debian12:nonroot@sha256:1b7b9f0f0e0a1d2155f531db587cc48ec26aaf97ab64364225f5bf18a054e66a
WORKDIR /var/lib/volna-key-transparency
COPY --from=build --chown=65532:65532 /out/volna-key-transparency-log /usr/local/bin/volna-key-transparency-log
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/volna-key-transparency-log"]
