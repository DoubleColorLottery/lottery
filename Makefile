# DoubleBall Lottery Monorepo Makefile

.PHONY: help build build-web build-contracts test test-web test-contracts test-flap-fork verify-flap-port audit-contracts docker-build docker-up docker-down clean

help:
	@echo "DoubleBall Lottery - Monorepo commands:"
	@echo ""
	@echo "  make build              - Build contracts and web"
	@echo "  make build-web          - Build Nuxt web app"
	@echo "  make build-contracts    - Build Foundry contracts and sync ABIs"
	@echo "  make test               - Run contracts and stable web tests"
	@echo "  make test-web           - Run stable web tests"
	@echo "  make test-flap-fork     - Run the live Flap VaultPortal fork test"
	@echo "  make verify-flap-port   - Run the complete Flap release gate"
	@echo "  make audit-contracts    - Run Slither contract audit"
	@echo "  make docker-build       - Build Docker images"
	@echo "  make docker-up          - Start web + SurrealDB via Docker Compose"
	@echo "  make docker-down        - Stop Docker Compose services"
	@echo "  make clean              - Clean generated artifacts"

build:
	bun run build

build-web:
	bun run build:web

build-contracts:
	bun run build:contracts

test:
	bun run test

test-web:
	bun run test:web

test-contracts:
	bun run test:contracts

test-flap-fork:
	bun run test:flap:fork

verify-flap-port:
	bun run verify:flap-port

audit-contracts:
	bun run --cwd packages/contracts audit:slither

docker-build:
	bun run docker:build

docker-up:
	bun run docker:up

docker-down:
	bun run docker:down

clean:
	rm -rf .nuxt .output out cache broadcast
	rm -rf apps/web/.nuxt apps/web/.output apps/web/dist apps/web/.data
	rm -rf packages/contracts/out packages/contracts/cache packages/contracts/broadcast
