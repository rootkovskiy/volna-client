FROM node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8 AS build
WORKDIR /source
RUN npm install --global pnpm@11.7.0
COPY . .
RUN CI=true PNPM_CONFIG_IGNORE_SCRIPTS=true pnpm --filter @volna/key-directory-witness deploy --prod /deploy \
 && cp packages/volna-messaging-client/LICENSE /deploy/LICENSE \
 && rm -rf /deploy/test /deploy/Dockerfile /deploy/pnpm-lock.yaml /deploy/pnpm-workspace.yaml \
 && for package_root in /deploy/node_modules/.pnpm/@volna+messaging-client*/node_modules/@volna/messaging-client; do \
      rm -rf "$package_root/rust" "$package_root/scripts" "$package_root/test" \
        "$package_root/pnpm-lock.yaml" "$package_root/pnpm-lock.public.yaml" "$package_root/tsconfig.json"; \
    done

FROM node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8 AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /deploy/ ./
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
 && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    /usr/local/bin/pnpm /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "src/main.mjs"]
