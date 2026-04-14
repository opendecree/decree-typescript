.PHONY: up setup down clean help

## up: Start the decree server (postgres + redis + migrations + service)
up:
	cd ../../decree && docker compose up -d --wait service

## setup: Seed example schema, tenant, and config (writes .tenant-id)
setup: up
	decree seed --addr localhost:9090 seed.yaml

## down: Stop the server and remove volumes
down:
	cd ../../decree && docker compose down -v

## clean: Remove generated files
clean:
	rm -f .tenant-id
	rm -rf dist/ node_modules/

## help: Show this help
help:
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/## //' | column -t -s ':'
