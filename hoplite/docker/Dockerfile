ARG NGINX_VERSION=1.28.0

FROM rust:1.89-bookworm AS builder
ARG NGINX_VERSION
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential ca-certificates curl libpcre2-dev libssl-dev zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY . .
RUN CARGO_TARGET_DIR=/src/target cargo build --manifest-path hoplite/runtime/Cargo.toml --release
RUN curl -fsSLO "https://nginx.org/download/nginx-${NGINX_VERSION}.tar.gz" \
    && tar -xzf "nginx-${NGINX_VERSION}.tar.gz" \
    && cd "nginx-${NGINX_VERSION}" \
    && HOPLITE_RUNTIME_DIR=/src/target/release \
       ./configure --prefix=/opt/hoplite/nginx \
         --with-http_ssl_module --with-threads \
         --add-module=/src/hoplite/nginx \
    && make -j"$(nproc)" \
    && make install

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates libpcre2-8-0 libssl3 zlib1g \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /opt/hoplite/nginx /opt/hoplite/nginx
COPY hoplite/docker/nginx.conf /opt/hoplite/nginx/conf/nginx.conf
COPY hoplite/examples/app.hal /etc/hestia/app.hal
COPY browser/src /opt/hestia/browser/src
COPY browser/demo /opt/hestia/browser/demo
EXPOSE 8080
ENTRYPOINT ["/opt/hoplite/nginx/sbin/nginx"]
CMD ["-g", "daemon off;"]
