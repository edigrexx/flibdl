# Этап 1: Использование готового образа cargo-chef
FROM lukemathwalker/cargo-chef:latest-rust-bookworm AS chef
ENV CARGO_REGISTRIES_CRATES_IO_PROTOCOL=sparse
WORKDIR /app

# Этап 2: Подготовка рецепта (анализ зависимостей)
FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

# Этап 3: Кэшированная сборка зависимостей
FROM chef AS builder
RUN apt-get update && apt-get install -y cmake && rm -rf /var/lib/apt/lists/*
COPY --from=planner /app/recipe.json recipe.json
# Собираем ТОЛЬКО зависимости (кэшируется Docker'ом)
RUN cargo chef cook --release --recipe-path recipe.json
# Теперь копируем исходный код
COPY . .
# Строим сам бинарник (это будет быстро)
RUN cargo build --release --bin books_downloader

# Этап 4: Финальный легковесный образ
FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y openssl ca-certificates curl jq \
    && rm -rf /var/lib/apt/lists/*

RUN update-ca-certificates

COPY ./scripts/*.sh /
RUN chmod +x /*.sh

WORKDIR /app

COPY --from=builder /app/target/release/books_downloader /usr/local/bin
CMD ["/start.sh"]
